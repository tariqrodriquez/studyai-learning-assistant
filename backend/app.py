from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import re
import fitz
from docx import Document
import sqlite3
from datetime import datetime
from openai import OpenAI
from dotenv import load_dotenv
import json
from werkzeug.security import generate_password_hash, check_password_hash


load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=False)

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

DATABASE = "study_assistant.db"

latest_extracted_text = ""
latest_upload_id = None
current_user_id = None
latest_study_notes = ""
latest_subject_type = "general"   # set by /detect-subject
latest_difficulty   = "intermediate"  # set by frontend on each request


# ── DB ────────────────────────────────────────────────────────────────────────

def init_db():
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS uploads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            filename TEXT NOT NULL,
            extracted_text TEXT,
            summary TEXT,
            quiz_questions TEXT,
            quiz_score TEXT,
            flashcards TEXT,
            subject_type TEXT,
            upload_date TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # migrate: add new columns if they don't exist yet
    for col, typedef in [
        ("quiz_questions", "TEXT"),
        ("flashcards",     "TEXT"),
        ("subject_type",   "TEXT"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE uploads ADD COLUMN {col} {typedef}")
        except Exception:
            pass  # column already exists

    conn.commit()
    conn.close()


def clean_text(text):
    text = text.replace("\n", " ")
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    text = re.sub(r"([.!?])([A-Z])", r"\1 \2", text)
    text = re.sub(r'(")([A-Za-z])', r"\1 \2", text)
    text = re.sub(r'([A-Za-z])(")', r"\1 \2", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


GROUNDING_RULES = """
CRITICAL RULES:
- Every fact, definition, example, quiz question, answer choice, and flashcard MUST be supported by the study material provided.
- Do NOT add context, background knowledge, assumptions, or explanations from outside the document.
- If something is not in the document, do not include it.
- A user should be able to verify every sentence against the original uploaded document.
- Do NOT write analytical or concluding sentences that summarize meaning — only restate what the document says.
- Write in short paragraphs of 3-4 sentences maximum, each covering ONE concept only.
- Do NOT cite dialogue speaker labels like "EUTH." or "SOC." or section headings like "II." or "III."
- Do NOT mention the author, speaker, or presenter by name in the notes.
- Do NOT frame notes as "X discusses..." or "X argues..." or "X points out..."
- Write notes about the CONCEPTS and CONTENT only, not about who is presenting them.
- Bad example: "Martin Rees discusses the climate challenge..."
- Good example: "Climate change poses a significant geopolitical risk..."
- Write as if summarizing a textbook chapter, not a lecture or talk by a named person.
- Focus only on the facts, concepts, definitions, and arguments in the material.
- Do NOT write a summary or concluding paragraph.
- Do NOT use phrases like "In summary", "In conclusion", or "Overall".
- Stop after the last concept paragraph.
- Randomize which option (A, B, C, or D) is the correct answer across questions.
- Do NOT put the correct answer as option A more than 25% of the time.
- Distribute correct answers evenly across A, B, C, and D positions.
"""

SUBJECT_PROMPTS = {
    "math": """
You are an AI study assistant specialising in mathematics.
Convert the following material into structured study notes for a college student.

Requirements:
- Explain every concept step-by-step.
- Include formulas only if they appear in the material.
- Use $...$ for mathematical expressions.
- Show worked examples only if examples appear in the material.
- Define variables and notation used in the material.
- Organise notes by topic/concept.
- Do NOT use markdown headings, bullet points, bold text, or code fences.
- Write in clear paragraphs only.
- Write enough detail that a student can study from the notes alone.
""",

    "science": """
You are an AI study assistant specialising in science.
Convert the following material into structured study notes for a college student.

Requirements:
- Include key definitions, laws, principles, formulas, mechanisms, and processes from the material.
- Include scientists, discoveries, and dates only if they appear in the material.
- Use $...$ for chemical formulas or physics equations when needed.
- Explain processes clearly using only the provided material.
- Do NOT use markdown headings, bullet points, bold text, or code fences.
- Write in clear paragraphs only.
""",

    "cs": """
You are an AI study assistant specialising in computer science.
Convert the following material into structured study notes for a college student.

Requirements:
- Explain algorithms, data structures, operations, and concepts clearly.
- Include time and space complexity where they appear or are directly supported by the material.
- Write Big-O notation in plain text, such as O(1), O(n), or O(n log n).
- Include pseudocode only when it helps explain an algorithm or data structure already present in the material.
- Do not generate full programs unless the source material includes them.
- Explain why the algorithm or data structure is used only when supported by the material.
- Include advantages, disadvantages, and limitations where relevant.
- Define all technical terms.
- Do NOT use markdown headings, bullet points, bold text, or code fences.
- Write in clear paragraphs only.
""",

    "general": """
You are an AI study assistant.
Convert the following study material into structured study notes for a college student.

Requirements:
- Include all major concepts, definitions, people, theories, formulas, dates, and key examples from the material.
- Preserve information likely to appear on quizzes or exams.
- Remove unnecessary repetition and filler.
- Organise into clear short paragraphs.
- Write enough detail that a student can study from the notes without reading the full material.
- Do NOT use markdown headings, bullet points, bold text, or code fences.
- Write in clear paragraphs only.
""",
}

DIFFICULTY_ADDONS = {
    "beginner": """
Use simple wording.
Ask mostly definition and recall questions.
Avoid tricky answer choices.
Each question should test one basic idea.
""",

    "intermediate": """
Assume basic familiarity with the subject.
Ask a mix of definition, concept, and application questions.
Include some questions that require comparing ideas or choosing the best explanation.
""",

    "advanced": """
Assume strong prior knowledge.
Ask application, analysis, and scenario-based questions.
Use more challenging distractors.
Require the student to apply concepts, compare tradeoffs, identify edge cases, or reason through examples.
Avoid simple definition-only questions.
"""
}

QUIZ_SUBJECT_PROMPTS = {
    "math": """
Create 8-12 multiple choice questions based ONLY on the study notes below.

Requirements:
- Mix calculation, conceptual, and step-identification questions.
- Include math expressions using $...$ when needed.
- The correct answer must be directly supported by the study notes.
- Do not introduce information not present in the study notes.
- Return ONLY valid JSON.
""",

    "science": """
Create 8-12 multiple choice questions based ONLY on the study notes below.

Requirements:
- Mix conceptual, definition, and application questions.
- Include equations using $...$ when needed.
- The correct answer must be directly supported by the study notes.
- Do not introduce information not present in the study notes.
- Return ONLY valid JSON.
""",

    "cs": """
Create 8-12 multiple choice questions based ONLY on the study notes below.

Requirements:
- Mix algorithm, complexity, implementation, and concept questions.
- Use plain-text Big-O notation such as O(1), O(n), or O(n log n).
- The correct answer must be directly supported by the study notes.
- Do not introduce information not present in the study notes.
- Return ONLY valid JSON.
""",

    "general": """
Create 8-12 multiple choice questions based ONLY on the study notes below.

Requirements:
- Questions must test important concepts.
- Make questions useful for exam preparation.
- The correct answer must be directly supported by the study notes.
- Do not introduce information not present in the study notes.
- Return ONLY valid JSON.
""",
}


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def home():
    return jsonify({"message": "AI Study Assistant Backend Running"})


@app.route("/upload", methods=["POST"])
def upload_file():
    global latest_extracted_text, latest_upload_id, latest_study_notes, latest_subject_type

    file = request.files.get("file")
    if not file:
        return jsonify({"error": "No file uploaded"}), 400

    file_path = os.path.join(UPLOAD_FOLDER, file.filename)
    file.save(file_path)

    extracted_text = ""
    try:
        if file.filename.endswith(".pdf"):
            pdf = fitz.open(file_path)
            for page in pdf:
                extracted_text += clean_text(page.get_text()) + " "
            pdf.close()
        elif file.filename.endswith(".docx"):
            doc = Document(file_path)
            for para in doc.paragraphs:
                extracted_text += clean_text(para.text) + " "
        else:
            return jsonify({"error": "Unsupported file type"}), 400
    except Exception:
        return jsonify({
            "error": "File could not be processed. It may be corrupted, encrypted, or unsupported."
        }), 400

    latest_extracted_text = clean_text(extracted_text)
    latest_study_notes = ""          # reset on new upload
    latest_subject_type = "general"  # reset on new upload

    user_id = request.form.get("user_id") or current_user_id

    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO uploads (filename, extracted_text, upload_date, user_id)
    VALUES (?, ?, ?, ?)
""", (
    file.filename,
    latest_extracted_text,
    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    user_id
))
    latest_upload_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return jsonify({"filename": file.filename, "preview": latest_extracted_text[:1000]})


# ── Subject detection ────────────────────────────────────────────────────

@app.route("/detect-subject", methods=["GET"])
def detect_subject():
    global latest_subject_type

    if not latest_extracted_text:
        return jsonify({"error": "No document uploaded yet"}), 400

    prompt = f"""
Classify the following academic text into exactly one of these categories:
math, science, cs, general

Reply with ONLY the single category word, nothing else.

Text (first 2000 chars):
{latest_extracted_text[:2000]}
"""
    try:
        response = client.responses.create(
            model="gpt-4.1-mini",
            input=prompt
        )
        subject = response.output_text.strip().lower()
        if subject not in ("math", "science", "cs", "general"):
            subject = "general"
        latest_subject_type = subject

        if latest_upload_id:
            conn = sqlite3.connect(DATABASE)
            cursor = conn.cursor()
            cursor.execute("UPDATE uploads SET subject_type = ? WHERE id = ?",
                           (subject, latest_upload_id))
            conn.commit()
            conn.close()

        return jsonify({"subject_type": subject})
    except Exception as e:
        print(e)
        return jsonify({"error": "Subject detection failed"}), 500


# ── Summarize ────────────────────────────────

@app.route("/summarize", methods=["GET"])
def summarize_text():
    global latest_study_notes

    if not latest_extracted_text:
        return jsonify({"error": "No document uploaded yet"}), 400

    difficulty = request.args.get("difficulty", "intermediate")
    subject = latest_subject_type

    base_prompt = SUBJECT_PROMPTS.get(subject, SUBJECT_PROMPTS["general"])
    diff_addon = DIFFICULTY_ADDONS.get(
        difficulty,
        DIFFICULTY_ADDONS["intermediate"]
    )

    prompt = f"""
{base_prompt}

Difficulty level: {difficulty.upper()}
{diff_addon}

{GROUNDING_RULES}

Study Material:
{latest_extracted_text[:8000]}
"""

    try:
        response = client.responses.create(
            model="gpt-4.1-mini",
            input=prompt,
            temperature=0
        )

        summary = response.output_text

        # Strip markdown formatting
        summary = re.sub(r'\*\*(.+?)\*\*', r'\1', summary)
        summary = re.sub(r'\*(.+?)\*', r'\1', summary)
        summary = re.sub(r'^#{1,6}\s+', '', summary, flags=re.MULTILINE)

        # Strip simple LaTeX formatting
        summary = re.sub(r'\$(.+?)\$', r'\1', summary)
        summary = summary.replace("\\(", "")
        summary = summary.replace("\\)", "")
        summary = summary.replace("\\[", "")
        summary = summary.replace("\\]", "")

        latest_study_notes = summary

    except Exception as e:
        print(e)
        return jsonify({"error": "AI summary generation failed."}), 500

    if latest_upload_id:
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()

        cursor.execute("""
            UPDATE uploads
            SET summary = ?
            WHERE id = ?
        """, (summary, latest_upload_id))

        conn.commit()
        conn.close()

    return jsonify({
        "summary": summary,
        "subject_type": subject,
        "difficulty": difficulty
    })

# ── Quiz  ─────────────────────────────────────

@app.route("/generate-quiz", methods=["GET"])
def generate_quiz():
    if not latest_study_notes:
        return jsonify({"error": "Please generate study notes before creating a quiz."}), 400

    difficulty = request.args.get("difficulty", "intermediate")
    subject = latest_subject_type
    diff_addon = DIFFICULTY_ADDONS.get(difficulty, DIFFICULTY_ADDONS["intermediate"])
    quiz_instructions = QUIZ_SUBJECT_PROMPTS.get(subject, QUIZ_SUBJECT_PROMPTS["general"])

    prompt = f"""
You are an AI study assistant.

{quiz_instructions}

Difficulty level: {difficulty.upper()}
{diff_addon}

Requirements:
- Do not introduce information not in the study notes.
- Each question must have exactly 4 answer choices labelled A), B), C), D).
- Only one answer is correct.
- The correct answer must exactly match one of the four answer choices.
- Make all answer choices similar in length and style.
- Do not make the correct answer noticeably longer or more detailed than the incorrect answers.
- Distractors must be plausible and based on related concepts from the notes.
- Avoid obvious wrong answers.
- Keep each answer choice under 15 words when possible.
- Do not use absolute words like "exact", "always", or "only" unless the study notes clearly support them.
- Return ONLY valid JSON — no markdown, no backticks, no preamble.

Format:
[
  {{
    "question": "...",
    "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
    "answer": "A) ..."
  }}
]

{GROUNDING_RULES}

Study Notes:
{latest_study_notes}
"""
    try:
        response = client.responses.create(
            model="gpt-4.1-mini",
            input=prompt,
            temperature=0
        )

        quiz_text = response.output_text
        quiz_text = quiz_text.replace("```json", "")
        quiz_text = quiz_text.replace("```", "")
        quiz_text = quiz_text.strip()

        quiz = json.loads(quiz_text)

        import random

        for q in quiz:
            correct_answer = q["answer"]
            options = q["options"]

            correct_text = correct_answer.split(")", 1)[1].strip()

            option_texts = [
                option.split(")", 1)[1].strip()
                for option in options
            ]

            random.shuffle(option_texts)

            labels = ["A)", "B)", "C)", "D)"]

            new_options = [
                f"{labels[i]} {option_texts[i]}"
                for i in range(4)
            ]

            new_answer = ""

            for option in new_options:
                if option.split(")", 1)[1].strip() == correct_text:
                    new_answer = option
                    break

            q["options"] = new_options
            q["answer"] = new_answer

        if latest_upload_id:
            conn = sqlite3.connect(DATABASE)
            cursor = conn.cursor()

            cursor.execute("""
                UPDATE uploads
                SET quiz_questions = ?
                WHERE id = ?
            """, (json.dumps(quiz), latest_upload_id))

            conn.commit()
            conn.close()

        return jsonify({"quiz": quiz})

    except Exception as e:
        print(e)
        return jsonify({"error": "Quiz generation failed"}), 500

@app.route("/generate-flashcards", methods=["GET"])
def generate_flashcards():
    if not latest_study_notes:
        return jsonify({"error": "Please generate study notes before creating flashcards."}), 400

    difficulty = request.args.get("difficulty", "intermediate")
    subject = latest_subject_type
    diff_addon = DIFFICULTY_ADDONS.get(difficulty, DIFFICULTY_ADDONS["intermediate"])

    prompt = f"""
You are an AI study assistant creating flashcards.

Create 10-15 flashcards based ONLY on the source document below.
Each flashcard has a front (term, concept, or question) and a back (EXACT VERBATIM QUOTE from the document).

Difficulty level: {difficulty.upper()}
{diff_addon}

CRITICAL RULES:
- The BACK must be copied WORD FOR WORD from the source document. 
- Do NOT write a single word that is not in the source document.
- Do NOT summarize, explain, or paraphrase — only copy.
- If you cannot find an exact quote, skip that flashcard entirely.
- A plagiarism detector will compare every back card against the source document.

Format:
[
{{
    "front": "...",
    "back": "..."
}}
]

{GROUNDING_RULES}

Study Notes:
{latest_study_notes}
"""

    try:
        response = client.responses.create(
            model="gpt-4.1-mini",
            input=prompt,
            temperature=0
        )

        cards_text = response.output_text.replace("```json", "").replace("```", "").strip()
        flashcards = json.loads(cards_text)

        if latest_upload_id:
            conn = sqlite3.connect(DATABASE)
            cursor = conn.cursor()

            cursor.execute("""
                UPDATE uploads
                SET flashcards = ?
                WHERE id = ?
            """, (json.dumps(flashcards), latest_upload_id))

            conn.commit()
            conn.close()

        return jsonify({"flashcards": flashcards})

    except Exception as e:
        print(e)
        return jsonify({"error": "Flashcard generation failed"}), 500

@app.route("/verify-sources", methods=["POST"])
def verify_sources():
    if not latest_extracted_text:
        return jsonify({"error": "No document uploaded"}), 400

    data = request.get_json()
    paragraphs = data.get("paragraphs", [])

    if not paragraphs:
        return jsonify({"error": "No paragraphs provided"}), 400

    prompt = f"""
You are a source verification assistant.

For each paragraph below, find the single most relevant sentence or phrase from the source document that directly supports it.
Copy that sentence EXACTLY, word for word, from the source document.

Return ONLY valid JSON — no markdown, no backticks:
[
  {{
    "paragraph_index": 0,
    "source_quote": "exact verbatim quote from the source document"
  }}
]

PARAGRAPHS TO VERIFY:
{json.dumps([{"index": i, "text": p} for i, p in enumerate(paragraphs)])}

SOURCE DOCUMENT:
{latest_extracted_text[:8000]}
"""

    try:
        response = client.responses.create(
            model="gpt-4.1-mini",
            input=prompt,
            temperature=0
        )
        result = response.output_text.replace("```json","").replace("```","").strip()
        verified = json.loads(result)
        return jsonify({"verified": verified})
    except Exception as e:
        print(e)
        return jsonify({"error": "Verification failed"}), 500
    
@app.route("/save-score", methods=["POST"])
def save_score():
    global latest_upload_id
    data  = request.get_json()
    score = data.get("score")
    total = data.get("total")

    if not latest_upload_id:
        return jsonify({"error": "No upload record found"}), 400

    quiz_score = f"{score}/{total}"
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("UPDATE uploads SET quiz_score = ? WHERE id = ?",
                   (quiz_score, latest_upload_id))
    conn.commit()
    conn.close()

    return jsonify({"message": "Quiz score saved", "quiz_score": quiz_score})


@app.route("/history", methods=["GET"])
def get_history():
    user_id = request.args.get("user_id") or current_user_id
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, filename, summary, quiz_score, upload_date, quiz_questions,
               flashcards, subject_type
        FROM uploads
        WHERE user_id = ?
        ORDER BY id DESC
    """, (user_id,))
    rows = cursor.fetchall()
    conn.close()

    history = []
    for row in rows:
        history.append({
            "id":             row[0],
            "filename":       row[1],
            "summary":        row[2],
            "quiz_score":     row[3],
            "upload_date":    row[4],
            "quiz_questions": row[5],
            "flashcards":     row[6],
            "subject_type":   row[7],
        })

    return jsonify({"history": history})

@app.route("/delete-history/<int:upload_id>", methods=["DELETE"])
def delete_history(upload_id):
    user_id = request.args.get("user_id") or current_user_id

    if not user_id:
        return jsonify({"error": "Please log in first"}), 401

    conn = sqlite3.connect(DATABASE, timeout=30)
    cursor = conn.cursor()

    cursor.execute("""
        DELETE FROM uploads
        WHERE id = ? AND user_id = ?
    """, (upload_id, user_id))

    conn.commit()
    conn.close()

    return jsonify({"message": "History item deleted"})


@app.route("/register", methods=["POST"])
def register():
    data     = request.get_json()
    username = data.get("username")
    password = data.get("password")

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    password_hash = generate_password_hash(password)
    try:
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()
        cursor.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)",
                       (username, password_hash))
        conn.commit()
        conn.close()
        return jsonify({"message": "User registered successfully"})
    except sqlite3.IntegrityError:
        return jsonify({"error": "Username already exists"}), 400


@app.route("/login", methods=["POST"])
def login():
    global current_user_id
    data     = request.get_json()
    username = data.get("username")
    password = data.get("password")

    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("SELECT id, password_hash FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()
    conn.close()

    if not user or not check_password_hash(user[1], password):
        return jsonify({"error": "Invalid username or password"}), 401

    current_user_id = user[0]
    return jsonify({"message": "Login successful", "user_id": user[0], "username": username})


@app.route("/stats", methods=["GET"])
def get_stats():
    user_id = request.args.get("user_id") or current_user_id

    if not user_id:
        return jsonify({"error": "Please log in first"}), 401

    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT quiz_score, upload_date
        FROM uploads
        WHERE user_id = ?
        ORDER BY id DESC
    """, (user_id,))

    rows = cursor.fetchall()
    conn.close()

    total_uploads = len(rows)
    quizzes_completed = 0
    total_percentage = 0
    best_score = 0
    recent_activity = []

    for row in rows:
        quiz_score, upload_date = row

        recent_activity.append({
            "quiz_score": quiz_score,
            "upload_date": upload_date
        })

        if quiz_score:
            try:
                score, total = quiz_score.split("/")
                pct = (int(score) / int(total)) * 100

                total_percentage += pct
                quizzes_completed += 1

                if pct > best_score:
                    best_score = pct

            except Exception:
                pass

    average_score = (
        round(total_percentage / quizzes_completed, 1)
        if quizzes_completed
        else 0
    )

    return jsonify({
        "total_uploads": total_uploads,
        "quizzes_completed": quizzes_completed,
        "average_score": average_score,
        "best_score": round(best_score, 1),
        "recent_activity": recent_activity[:5],
    })


if __name__ == "__main__":
    init_db()
    app.run(debug=True)