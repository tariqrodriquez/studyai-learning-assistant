import axios from "axios";
import { useEffect, useState } from "react";
import "./App.css";

const API = "https://studyai-learning-assistant.onrender.com";

// ─── KaTeX renderer ──────────────────────────────────────────────────────────
// Renders inline $...$ math expressions using KaTeX if available,
// otherwise falls back to plain text.
function MathText({ text }) {
  if (!text) return null;

  let katex;
  try { katex = require("katex"); } catch { /* katex not installed yet */ }

  if (!katex) return <span>{text}</span>;

  const parts = text.split(/(\$[^$]+\$)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith("$") && part.endsWith("$")) {
          const math = part.slice(1, -1);
          try {
            return (
              <span
                key={i}
                dangerouslySetInnerHTML={{
                  __html: katex.renderToString(math, { throwOnError: false }),
                }}
              />
            );
          } catch {
            return <span key={i}>{part}</span>;
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
function CitedParagraph({ text }) {
  const citationMatch = text.match(/\[Source:\s*"(.+?)"\]/);
  if (!citationMatch) {
    return <p><MathText text={text} /></p>;
  }
  const body = text.replace(/\[Source:\s*".+?"\]/, "").trim();
  const citation = citationMatch[1];
  return (
    <div className="cited-paragraph">
      <p><MathText text={body} /></p>
      <div className="citation-block">
        <i className="ti ti-quote" aria-hidden="true" />
        <span className="citation-text">{citation}</span>
      </div>
    </div>
  );
}


// ─── Subject badge ────────────────────────────────────────────────────────────
const SUBJECT_META = {
  math:    { label: "Mathematics", icon: "ti-math-function", cls: "badge-blue"   },
  science: { label: "Science",     icon: "ti-flask",         cls: "badge-green"  },
  cs:      { label: "Comp Sci",    icon: "ti-code",          cls: "badge-purple" },
  general: { label: "General",     icon: "ti-book",          cls: "badge-muted"  },
};

function SubjectBadge({ subject }) {
  const meta = SUBJECT_META[subject] || SUBJECT_META.general;
  return (
    <span className={`badge ${meta.cls}`}>
      <i className={`ti ${meta.icon}`} aria-hidden="true" /> {meta.label}
    </span>
  );
}

// ─── Difficulty selector ──────────────────────────────────────────────────────
function DifficultySelector({ value, onChange }) {
  const levels = [
    { id: "beginner",     label: "Beginner",     icon: "ti-plant" },
    { id: "intermediate", label: "Intermediate", icon: "ti-flame" },
    { id: "advanced",     label: "Advanced",     icon: "ti-bolt"  },
  ];
  return (
    <div className="difficulty-row">
      {levels.map((l) => (
        <button
          key={l.id}
          className={`diff-btn ${value === l.id ? "active" : ""}`}
          onClick={() => onChange(l.id)}
        >
          <i className={`ti ${l.icon}`} aria-hidden="true" /> {l.label}
        </button>
      ))}
    </div>
  );
}

// ─── Flashcard flip ─────────────────────────────────────────────────
function Flashcard({ card, index, total }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className="flashcard-wrap" onClick={() => setFlipped(!flipped)}>
      <div className={`flashcard ${flipped ? "flipped" : ""}`}>
        <div className="flashcard-front">
          <div className="flashcard-counter">{index + 1} / {total}</div>
          <div className="flashcard-label">Term</div>
          <div className="flashcard-text"><MathText text={card.front} /></div>
          <div className="flashcard-hint">Click to reveal answer</div>
        </div>
      <div className="flashcard-back">
        <div className="flashcard-counter">{index + 1} / {total}</div>
        <div className="flashcard-label">Answer</div>
        <div className="flashcard-text"> <MathText text={card.back.replace(/\[Source:\s*"[^"]+"\]/g, '').trim()} /> </div>
        <div className="flashcard-hint">Click to flip back</div>
      </div>
      </div>
    </div>
  );
}

function FlashcardsView({ flashcards }) {
  const [current, setCurrent] = useState(0);

  if (!flashcards || flashcards.length === 0) return null;

  return (
    <div>
      <Flashcard card={flashcards[current]} index={current} total={flashcards.length} />
      <div className="flashcard-nav">
        <button
          className="btn btn-ghost"
          onClick={() => setCurrent((c) => Math.max(0, c - 1))}
          disabled={current === 0}
        >
          <i className="ti ti-arrow-left" aria-hidden="true" /> Prev
        </button>
        <div className="flashcard-dots">
          {flashcards.map((_, i) => (
            <div
              key={i}
              className={`fc-dot ${i === current ? "active" : ""}`}
              onClick={() => setCurrent(i)}
            />
          ))}
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => setCurrent((c) => Math.min(flashcards.length - 1, c + 1))}
          disabled={current === flashcards.length - 1}
        >
          Next <i className="ti ti-arrow-right" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ stats, onViewStats }) {
  useEffect(() => { onViewStats(); }, []);

  if (!stats) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><i className="ti ti-loader" aria-hidden="true" /></div>
        <div className="empty-text">Loading dashboard…</div>
      </div>
    );
  }

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon orange"><i className="ti ti-file-upload" aria-hidden="true" /></div>
          <div className="stat-value">{stats.total_uploads}</div>
          <div className="stat-label">Total uploads</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue"><i className="ti ti-brain" aria-hidden="true" /></div>
          <div className="stat-value">{stats.quizzes_completed}</div>
          <div className="stat-label">Quizzes completed</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><i className="ti ti-chart-line" aria-hidden="true" /></div>
          <div className="stat-value">{stats.average_score}%</div>
          <div className="stat-label">Average score</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon pink"><i className="ti ti-trophy" aria-hidden="true" /></div>
          <div className="stat-value">{stats.best_score}%</div>
          <div className="stat-label">Best score</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><i className="ti ti-clock" aria-hidden="true" /> Recent activity</div>
        {stats.recent_activity.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><i className="ti ti-mood-empty" aria-hidden="true" /></div>
            <div className="empty-text">No activity yet</div>
          </div>
        ) : (
          stats.recent_activity.map((item, i) => (
            <div className="activity-item" key={i}>
              <div className="activity-dot" />
              <div className="activity-info">
                <div className="activity-name">{item.upload_date}</div>
                <div className="activity-score">
                  {item.quiz_score ? `Score: ${item.quiz_score}` : "No quiz taken"}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Upload page ──────────────────────────────────────────────────────────────
function UploadPage({
  file, setFile, preview, filename,
  summary, quiz, flashcards,
  selectedAnswers, score,
  subjectType, difficulty, onDifficultyChange,
  onUpload, onSummarize, onGenerateQuiz, onGenerateFlashcards,
  onAnswerChange, onSubmitQuiz, onDownloadNotes,
  detecting,
}) {
  const [view, setView] = useState("notes");

  // Reset to notes tab when new content arrives
  useEffect(() => { if (summary) setView("notes"); }, [summary]);

  const hasContent = summary || quiz.length > 0 || flashcards.length > 0;
  const [verifying, setVerifying]       = useState(false);
  const [sourcesMap, setSourcesMap]     = useState({});

  const handleVerify = async () => {
    setVerifying(true);
    setSourcesMap({});
    try {
      const paragraphs = summary.split("\n\n").filter(p => p.trim());
      const res = await axios.post(API + "/verify-sources", { paragraphs });
      const map = {};
      res.data.verified.forEach(item => {
        map[item.paragraph_index] = item.source_quote;
      });
      setSourcesMap(map);
    } catch {
      alert("Verification failed.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div>
      {/* Difficulty selector — always visible once a file is uploaded */}
      {preview && (
        <div className="card" style={{ marginBottom: "16px" }}>
          <div className="card-title-row">
            <div className="card-title" style={{ margin: 0 }}>
              <i className="ti ti-adjustments" aria-hidden="true" /> Settings
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {detecting && (
                <span className="badge badge-muted">
                  <i className="ti ti-loader" aria-hidden="true" /> Detecting subject…
                </span>
              )}
              {subjectType && !detecting && <SubjectBadge subject={subjectType} />}
            </div>
          </div>
          <div style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "10px" }}>
            Difficulty level
          </div>
          <DifficultySelector value={difficulty} onChange={onDifficultyChange} />
        </div>
      )}

      {/* Upload card */}
      <div className="card">
        <div className="card-title">
          <i className="ti ti-upload" aria-hidden="true" /> Upload document
        </div>

        {!preview ? (
          <label className="upload-zone">
            <input
              type="file"
              accept=".pdf,.docx"
              style={{ display: "none" }}
              onChange={(e) => setFile(e.target.files[0])}
            />
            <div className="upload-icon"><i className="ti ti-file-text" aria-hidden="true" /></div>
            <div className="upload-title">
              {file ? file.name : "Drop your file here or click to browse"}
            </div>
            <div className="upload-sub">Supports PDF and DOCX files</div>
            {file && (
              <button
                className="btn btn-primary"
                style={{ marginTop: "16px" }}
                onClick={(e) => { e.preventDefault(); onUpload(); }}
              >
                <i className="ti ti-upload" aria-hidden="true" /> Upload
              </button>
            )}
          </label>
        ) : (
          <>
            <div className="file-header">
              <div className="card-title" style={{ margin: 0 }}>
                <i className="ti ti-file-text" aria-hidden="true" />
                {filename}
                <span className="badge badge-green">
                  <i className="ti ti-check" aria-hidden="true" /> Uploaded
                </span>
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button className="btn btn-ghost" onClick={onSummarize}>
                  <i className="ti ti-notes" aria-hidden="true" /> Generate notes
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={onGenerateFlashcards}
                  disabled={!summary}
                  title={!summary ? "Generate notes first" : ""}
                >
                  <i className="ti ti-cards" aria-hidden="true" /> Flashcards
                </button>
                <button
                  className="btn btn-primary"
                  onClick={onGenerateQuiz}
                  disabled={!summary}
                  title={!summary ? "Generate notes first" : ""}
                >
                  <i className="ti ti-list-check" aria-hidden="true" /> Generate quiz
                </button>
              </div>
            </div>

            <details style={{ marginTop: "12px" }}>
              <summary style={{ fontSize: "13px", color: "var(--muted)", cursor: "pointer" }}>
                Preview extracted text
              </summary>
              <pre className="preview-pre">{preview}</pre>
            </details>
          </>
        )}
      </div>

      {/* Tabs */}
      {hasContent && (
        <>
          <div className="tab-row">
            {summary && (
              <button className={`tab ${view === "notes" ? "active" : ""}`} onClick={() => setView("notes")}>
                <i className="ti ti-notes" aria-hidden="true" /> Notes
              </button>
            )}
            {flashcards.length > 0 && (
              <button className={`tab ${view === "flashcards" ? "active" : ""}`} onClick={() => setView("flashcards")}>
                <i className="ti ti-cards" aria-hidden="true" /> Flashcards
              </button>
            )}
            {quiz.length > 0 && (
              <button className={`tab ${view === "quiz" ? "active" : ""}`} onClick={() => setView("quiz")}>
                <i className="ti ti-list-check" aria-hidden="true" /> Quiz
              </button>
            )}
          </div>

          {/* Notes tab */}
          {view === "notes" && summary && (
  <div className="card">
    <div className="card-title-row">
      <div className="card-title" style={{ margin: 0 }}>
        <i className="ti ti-notes" aria-hidden="true" /> Study notes
        {subjectType && <SubjectBadge subject={subjectType} />}
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          className={"btn " + (Object.keys(sourcesMap).length > 0 ? "btn-primary" : "btn-ghost")}
          onClick={handleVerify}
          disabled={verifying}
        >
          <i className={"ti " + (verifying ? "ti-loader" : "ti-shield-check")} aria-hidden="true" />
          {verifying ? "Verifying..." : Object.keys(sourcesMap).length > 0 ? "Verified" : "Verify Sources"}
        </button>
        <button className="btn btn-ghost" onClick={onDownloadNotes}>
          <i className="ti ti-download" aria-hidden="true" /> Download .txt
        </button>
      </div>
    </div>
    <div className="notes-content">
      {summary.split("\n\n").filter(p => p.trim()).map((p, i) => (
        <div key={i}>
          <CitedParagraph text={p} />
          {sourcesMap[i] && (
            <div className="verify-quote">
              <i className="ti ti-shield-check" aria-hidden="true" />
              <span><strong>Source:</strong> "{sourcesMap[i]}"</span>
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
)}

          {/* Flashcards tab */}
          {view === "flashcards" && flashcards.length > 0 && (
            <div className="card">
              <div className="card-title">
                <i className="ti ti-cards" aria-hidden="true" /> Flashcards — {flashcards.length} cards
              </div>
              <FlashcardsView flashcards={flashcards} />
            </div>
          )}

          {/* Quiz tab */}
          {view === "quiz" && quiz.length > 0 && (
            <div className="card">
              <div className="card-title">
                <i className="ti ti-list-check" aria-hidden="true" /> Quiz — {quiz.length} questions
              </div>
              {quiz.map((q, qi) => (
                <div className="quiz-q" key={qi}>
                  <div className="quiz-q-text">{qi + 1}. <MathText text={q.question} /></div>
                  {q.options.map((opt, oi) => (
  <div
    key={oi}
    className={`quiz-option ${selectedAnswers[qi] === opt ? "selected" : ""}`}
    onClick={() => score === null && onAnswerChange(qi, opt)}
    style={{ cursor: score !== null ? "default" : "pointer" }}
  >
    <div className="radio-dot">
      <div className="inner-dot" />
    </div>

    <MathText text={opt} />
  </div>
))}
                      {score !== null && opt === q.answer && (
                        <span className="badge badge-green" style={{ marginLeft: "auto" }}>
                          <i className="ti ti-check" aria-hidden="true" /> Correct
                        </span>
                      )}
                      {score !== null && selectedAnswers[qi] === opt && opt !== q.answer && (
                        <span className="badge badge-danger" style={{ marginLeft: "auto" }}>
                          <i className="ti ti-x" aria-hidden="true" /> Wrong
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              {score === null ? (
                <button className="btn btn-primary" onClick={onSubmitQuiz}>
                  <i className="ti ti-send" aria-hidden="true" /> Submit quiz
                </button>
              ) : (
                <div className="score-result">
                  <div className="score-big">{score}/{quiz.length}</div>
                  <div className="score-label">
                    {Math.round((score / quiz.length) * 100)}% —{" "}
                    {score === quiz.length ? "🎉 Perfect!" : score >= quiz.length * 0.7 ? "👍 Nice work!" : "📖 Keep studying!"}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── History page ─────────────────────────────────────────────────────────────
function HistoryPage({ history, onDelete, onViewNotes, onViewQuiz, onViewFlashcards }) {
  return (
    <div className="card">
      <div className="card-title">
        <i className="ti ti-history" aria-hidden="true" /> Upload history
      </div>
      {history.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><i className="ti ti-inbox" aria-hidden="true" /></div>
          <div className="empty-text">No history yet — upload a file to get started</div>
        </div>
      ) : (
        history.map((item) => (
          <div className="history-row" key={item.id}>
            <div className="file-icon">
              <i className={`ti ${item.filename.endsWith(".pdf") ? "ti-file-type-pdf" : "ti-file-type-doc"}`} aria-hidden="true" />
            </div>
            <div style={{ flex: 1 }}>
              <div className="history-name">{item.filename}</div>
              <div className="history-meta" style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "4px" }}>
                {item.upload_date}
                {item.subject_type && <SubjectBadge subject={item.subject_type} />}
              </div>
            </div>
            {item.quiz_score ? (
              <span className="badge badge-orange">
                <i className="ti ti-star" aria-hidden="true" /> {item.quiz_score}
              </span>
            ) : (
              <span className="badge badge-muted">No quiz</span>
            )}
            <div className="action-btns">
              <button className="btn btn-ghost icon-btn" title="View notes" onClick={() => onViewNotes(item.summary)}>
                <i className="ti ti-notes" aria-hidden="true" />
              </button>
              {item.flashcards && (
                <button className="btn btn-ghost icon-btn" title="View flashcards" onClick={() => onViewFlashcards(item.flashcards)}>
                  <i className="ti ti-cards" aria-hidden="true" />
                </button>
              )}
              <button className="btn btn-ghost icon-btn" title="View quiz" onClick={() => onViewQuiz(item.quiz_questions, item.quiz_score)}>
                <i className="ti ti-list-check" aria-hidden="true" />
              </button>
              <button className="btn btn-danger icon-btn" title="Delete" onClick={() => onDelete(item.id)}>
                <i className="ti ti-trash" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Saved content page ───────────────────────────────────────────────────────
function SavedNotesPage({ notes, quiz, flashcards, showAnswers, onDownload, onBack }) {
  const [view, setView] = useState(notes ? "notes" : flashcards.length > 0 ? "flashcards" : "quiz");

  const hasNotes      = !!notes;
  const hasFlashcards = flashcards.length > 0;
  const hasQuiz       = quiz.length > 0;

  return (
    <div>
      <button className="btn btn-ghost back-btn" onClick={onBack}>
        <i className="ti ti-arrow-left" aria-hidden="true" /> Back to History
      </button>

      {(hasNotes || hasFlashcards || hasQuiz) && (
        <div className="tab-row">
          {hasNotes      && <button className={`tab ${view === "notes"      ? "active" : ""}`} onClick={() => setView("notes")}><i className="ti ti-notes" aria-hidden="true" /> Notes</button>}
          {hasFlashcards && <button className={`tab ${view === "flashcards" ? "active" : ""}`} onClick={() => setView("flashcards")}><i className="ti ti-cards" aria-hidden="true" /> Flashcards</button>}
          {hasQuiz       && <button className={`tab ${view === "quiz"       ? "active" : ""}`} onClick={() => setView("quiz")}><i className="ti ti-list-check" aria-hidden="true" /> Quiz</button>}
        </div>
      )}

      {view === "notes" && hasNotes && (
        <div className="card">
          <div className="card-title-row">
            <div className="card-title" style={{ margin: 0 }}>
              <i className="ti ti-notes" aria-hidden="true" /> Saved notes
            </div>
            <button className="btn btn-ghost" onClick={onDownload}>
              <i className="ti ti-download" aria-hidden="true" /> Download .txt
            </button>
          </div>
          <div className="notes-content">
            {notes.split("\n\n").map((p, i) => <p key={i}><MathText text={p} /></p>)}
          </div>
        </div>
      )}

      {view === "flashcards" && hasFlashcards && (
        <div className="card">
          <div className="card-title">
            <i className="ti ti-cards" aria-hidden="true" /> Saved flashcards — {flashcards.length} cards
          </div>
          <FlashcardsView flashcards={flashcards} />
        </div>
      )}

      {view === "quiz" && hasQuiz && (
        <div className="card">
          <div className="card-title">
            <i className="ti ti-list-check" aria-hidden="true" /> Saved quiz
          </div>
          {quiz.map((q, i) => (
            <div className="quiz-q" key={i}>
              <div className="quiz-q-text">{i + 1}. <MathText text={q.question} /></div>
              {q.options.map((opt, oi) => (
                <div key={oi} className={`quiz-option ${showAnswers && opt === q.answer ? "correct-answer" : ""}`}>
                  <div className="radio-dot" />
                  <MathText text={opt} />
                  {showAnswers && opt === q.answer && (
                    <span className="badge badge-green" style={{ marginLeft: "auto" }}>
                      <i className="ti ti-check" aria-hidden="true" /> Answer
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Login page ───────────────────────────────────────────────────────────────
function LoginPage({ onLogin, onRegister }) {
  const [tab, setTab]           = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-text">Study<span style={{ color: "#FF5C3A" }}>AI</span></div>
          <div className="login-sub">Your intelligent learning companion</div>
        </div>
        <div className="tab-row">
          <button className={`tab ${tab === "login"    ? "active" : ""}`} onClick={() => setTab("login")}>Sign in</button>
          <button className={`tab ${tab === "register" ? "active" : ""}`} onClick={() => setTab("register")}>Register</button>
        </div>
        <label>Username</label>
        <input className="input-field" placeholder="Enter your username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <label>Password</label>
        <input className="input-field" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
        {tab === "login" ? (
          <button className="btn btn-primary btn-full" onClick={() => onLogin(username, password)}>
            <i className="ti ti-login" aria-hidden="true" /> Sign in
          </button>
        ) : (
          <button className="btn btn-primary btn-full" onClick={() => onRegister(username, password)}>
            <i className="ti ti-user-plus" aria-hidden="true" /> Create account
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function App() {
  const [file, setFile]                       = useState(null);
  const [preview, setPreview]                 = useState("");
  const [filename, setFilename]               = useState("");
  const [summary, setSummary]                 = useState("");
  const [quiz, setQuiz]                       = useState([]);
  const [flashcards, setFlashcards]           = useState([]);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [score, setScore]                     = useState(null);
  const [history, setHistory]                 = useState([]);
  const [selectedNotes, setSelectedNotes]     = useState("");
  const [selectedQuiz, setSelectedQuiz]       = useState([]);
  const [selectedFlashcards, setSelectedFlashcards] = useState([]);
  const [selectedQuizScored, setSelectedQuizScored] = useState(false);
  const [loggedInUser, setLoggedInUser]       = useState(null);
  const [stats, setStats]                     = useState(null);
  const [page, setPage]                       = useState("dashboard");
  const [subjectType, setSubjectType]         = useState(null);
  const [difficulty, setDifficulty]           = useState("intermediate");
  const [detecting, setDetecting]             = useState(false);

  useEffect(() => {
    const savedUser = localStorage.getItem("loggedInUser");
    const savedUserId = localStorage.getItem("userId");
  
    if (savedUser && savedUserId) {
      setLoggedInUser(savedUser);
    }
  }, []);

  // ── Auth ──
  const handleRegister = async (u, p) => {
    try {
      const res = await axios.post(`${API}/register`, { username: u, password: p });
      alert(res.data.message);
    } catch (err) { alert(err.response?.data?.error || "Registration failed."); }
  };

  const handleLogin = async (u, p) => {
  try {
    const res = await axios.post(`${API}/login`, {
      username: u,
      password: p,
    });

    setLoggedInUser(res.data.username);

    localStorage.setItem("loggedInUser", res.data.username);
    localStorage.setItem("userId", res.data.user_id);
  } catch (err) {
    alert(err.response?.data?.error || "Login failed.");
  }
};

  const handleLogout = () => {
    localStorage.removeItem("loggedInUser");
    setLoggedInUser(null);
    setPreview(""); setFilename(""); setSummary("");
    setQuiz([]); setFlashcards([]); setSelectedAnswers({}); setScore(null);
    setHistory([]); setStats(null); setSubjectType(null);
  };

  // ── Features ──
  const handleViewStats = async () => {
    try {
      const userId = localStorage.getItem("userId");
  
      const res = await axios.get(`${API}/stats`, {
        params: {
          user_id: userId,
        },
      });
  
      setStats(res.data);
    } catch {
      alert("Could not load dashboard stats.");
    }
  };

  const handleUpload = async () => {
    if (!file) { alert("Please choose a PDF or DOCX file first."); return; }
    const formData = new FormData();
    formData.append("file", file);
    const userId = localStorage.getItem("userId");
    formData.append("user_id", userId);
    try {
      const res = await axios.post(`${API}/upload`, formData);
      setFilename(res.data.filename);
      setPreview(res.data.preview);
      setSummary(""); setQuiz([]); setFlashcards([]);
      setSelectedAnswers({}); setScore(null); setSubjectType(null);

      // Auto-detect subject after upload
      setDetecting(true);
      try {
        const det = await axios.get(`${API}/detect-subject`);
        setSubjectType(det.data.subject_type);
      } catch { /* non-fatal */ }
      finally { setDetecting(false); }

    } catch (err) { alert(err.response?.data?.error || "Upload failed."); }
  };

  const handleSummarize = async () => {
    try {
      const res = await axios.get(`${API}/summarize`, { params: { difficulty } });
      setSummary(res.data.summary);
      if (res.data.subject_type) setSubjectType(res.data.subject_type);
    } catch { alert("Summary generation failed."); }
  };

  const handleGenerateQuiz = async () => {
    if (!summary) { alert("Please generate study notes first before creating a quiz."); return; }
    try {
      const res = await axios.get(`${API}/generate-quiz`, { params: { difficulty } });
      setQuiz(res.data.quiz);
      setSelectedAnswers({}); setScore(null);
    } catch { alert("Quiz generation failed."); }
  };

  const handleGenerateFlashcards = async () => {
    if (!summary) { alert("Please generate study notes first before creating flashcards."); return; }
    try {
      const res = await axios.get(`${API}/generate-flashcards`, { params: { difficulty } });
      setFlashcards(res.data.flashcards);
    } catch { alert("Flashcard generation failed."); }
  };

  const handleViewHistory = async () => {
    try {
      const userId = localStorage.getItem("userId");
  
      const res = await axios.get(`${API}/history`, {
        params: { user_id: userId },
      });
  
      setHistory(res.data.history);
      setSelectedNotes("");
      setSelectedQuiz([]);
      setSelectedFlashcards([]);
      setPage("history");
    } catch {
      alert("Could not load history.");
    }
  };

  const handleDeleteHistory = async (id) => {
    try {
      const userId = localStorage.getItem("userId");
  
      await axios.delete(`${API}/delete-history/${id}`, {
        params: { user_id: userId },
      });
  
      setHistory(history.filter((item) => item.id !== id));
    } catch {
      alert("Could not delete history item.");
    }
  };

  
  const handleAnswerChange = (qi, opt) => setSelectedAnswers({ ...selectedAnswers, [qi]: opt });

  const handleSubmitQuiz = async () => {
    let s = 0;
    quiz.forEach((q, i) => { if (selectedAnswers[i] === q.answer) s++; });
    setScore(s);
    try {
      await axios.post(`${API}/save-score`, { score: s, total: quiz.length });
    } catch { alert("Score could not be saved."); }
  };

  const handleViewNotes = (notes) => {
    setSelectedNotes(notes || "No study notes saved for this upload.");
    setSelectedQuiz([]); setSelectedFlashcards([]);
    setPage("saved");
  };

  const handleViewSavedQuiz = (quizQuestions, quizScore) => {
    if (!quizQuestions) {
      setSelectedQuiz([]); setSelectedNotes("No quiz saved.");
      setSelectedQuizScored(false); setPage("saved"); return;
    }
    try {
      setSelectedQuiz(JSON.parse(quizQuestions));
      setSelectedQuizScored(!!quizScore);
      setSelectedNotes(""); setSelectedFlashcards([]);
      setPage("saved");
    } catch {
      setSelectedQuiz([]); setSelectedNotes("Could not load saved quiz.");
      setSelectedQuizScored(false); setPage("saved");
    }
  };

  const handleViewFlashcards = (flashcardsJson) => {
    if (!flashcardsJson) return;
    try {
      setSelectedFlashcards(JSON.parse(flashcardsJson));
      setSelectedNotes(""); setSelectedQuiz([]);
      setPage("saved");
    } catch { alert("Could not load saved flashcards."); }
  };

  const handleDownloadNotes = () => {
    const content = summary || selectedNotes;
    if (!content) { alert("No study notes available."); return; }
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "study_notes.txt"; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Nav ──
  const navItems = [
    { id: "dashboard", icon: "ti-layout-dashboard", label: "Dashboard" },
    { id: "upload",    icon: "ti-upload",           label: "Upload & Study" },
    { id: "history",   icon: "ti-history",          label: "History" },
  ];

  const pageTitles = {
    dashboard: ["Dashboard",      "Overview of your study progress"],
    upload:    ["Upload & Study", "Generate notes, flashcards, and quizzes"],
    history:   ["History",        "Review your past uploads and results"],
    saved:     ["Saved Content",  "Notes and quizzes from a past upload"],
  };

  if (!loggedInUser) return <LoginPage onLogin={handleLogin} onRegister={handleRegister} />;

  return (
    <div className="app">
      <div className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-text">Study<span className="logo-dot">AI</span></div>
          <div className="logo-sub">Learning Assistant</div>
        </div>

        <div className="nav-section">
          <div className="nav-label">Menu</div>
          {navItems.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${page === n.id || (n.id === "history" && page === "saved") ? "active" : ""}`}
              onClick={() => {
                if (page === "upload" && n.id !== "upload" && score === null) {
                  setQuiz([]); setSelectedAnswers({});
                }
                if (n.id === "history") { handleViewHistory(); }
                else { setPage(n.id); }
              }}
            >
              <i className={`ti ${n.icon}`} aria-hidden="true" />
              {n.label}
            </button>
          ))}
        </div>

        <div className="user-pill">
          <div className="user-avatar">{loggedInUser.slice(0, 2).toUpperCase()}</div>
          <div className="user-info">
            <div className="user-name">{loggedInUser}</div>
            <div className="user-role">Student</div>
          </div>
          <button className="btn btn-ghost icon-btn" title="Logout" onClick={handleLogout}>
            <i className="ti ti-logout" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="main">
        <div className="topbar">
          <div>
            <div className="page-title">{pageTitles[page][0]}</div>
            <div className="page-sub">{pageTitles[page][1]}</div>
          </div>
        </div>

        <div className="content">
          {page === "dashboard" && <Dashboard stats={stats} onViewStats={handleViewStats} />}

          {page === "upload" && (
            <UploadPage
              file={file} setFile={setFile}
              preview={preview} filename={filename}
              summary={summary} quiz={quiz} flashcards={flashcards}
              selectedAnswers={selectedAnswers} score={score}
              subjectType={subjectType} difficulty={difficulty}
              onDifficultyChange={setDifficulty}
              onUpload={handleUpload}
              onSummarize={handleSummarize}
              onGenerateQuiz={handleGenerateQuiz}
              onGenerateFlashcards={handleGenerateFlashcards}
              onAnswerChange={handleAnswerChange}
              onSubmitQuiz={handleSubmitQuiz}
              onDownloadNotes={handleDownloadNotes}
              detecting={detecting}
            />
          )}

          {page === "history" && (
            <HistoryPage
              history={history}
              onDelete={handleDeleteHistory}
              onViewNotes={handleViewNotes}
              onViewQuiz={handleViewSavedQuiz}
              onViewFlashcards={handleViewFlashcards}
            />
          )}

          {page === "saved" && (
            <SavedNotesPage
              notes={selectedNotes}
              quiz={selectedQuiz}
              flashcards={selectedFlashcards}
              showAnswers={selectedQuizScored}
              onDownload={handleDownloadNotes}
              onBack={() => setPage("history")}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;