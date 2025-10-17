export default function AboutPage() {
  return (
    <div>
      <h1 style={{ textAlign: 'center', fontSize: 36, fontWeight: 900, margin: '8px 0 22px' }}>Why teams choose Sparrow</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18 }}>
        {/* Row 1 */}
        <div className="tile" style={{ background: 'linear-gradient(180deg, rgba(6,29,27,.85), rgba(8,18,21,.9))' }}>
          <div className="mi" style={{ background: 'rgba(8,38,35,.9)', borderRadius: 12, width: 36, height: 36, marginBottom: 10 }}>💰</div>
          <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 8 }}>Save Costs</div>
          <div className="muted">Run usability tests at 25% of the cost of traditional methods without compromising quality.</div>
        </div>

        <div className="tile" style={{ background: 'linear-gradient(180deg, rgba(40,25,10,.85), rgba(29,18,14,.9))' }}>
          <div className="mi" style={{ background: 'rgba(44,28,9,.9)', borderRadius: 12, width: 36, height: 36, marginBottom: 10 }}>⚡</div>
          <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 8 }}>Instant Insights</div>
          <div className="muted">Get actionable results in minutes, not weeks. Make data‑driven decisions faster than ever.</div>
        </div>

        <div className="tile" style={{ background: 'linear-gradient(180deg, rgba(13,23,34,.85), rgba(12,19,27,.9))' }}>
          <div className="mi" style={{ background: 'rgba(15,32,45,.9)', borderRadius: 12, width: 36, height: 36, marginBottom: 10 }}>🎯</div>
          <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 8 }}>Scenario Simulation</div>
          <div className="muted">Test any customer journey across any device with AI users that behave like real people.</div>
        </div>

        {/* Row 2 */}
        <div className="tile" style={{ background: 'linear-gradient(180deg, rgba(38,18,45,.85), rgba(24,15,29,.9))' }}>
          <div className="mi" style={{ background: 'rgba(48,22,57,.9)', borderRadius: 12, width: 36, height: 36, marginBottom: 10 }}>🧠</div>
          <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 8 }}>Unbiased Results</div>
          <div className="muted">AI‑driven users eliminate human bias and provide consistent, objective feedback every time.</div>
        </div>

        <div className="tile" style={{ background: 'linear-gradient(180deg, rgba(42,18,27,.85), rgba(28,14,22,.9))' }}>
          <div className="mi" style={{ background: 'rgba(55,22,33,.9)', borderRadius: 12, width: 36, height: 36, marginBottom: 10 }}>🔒</div>
          <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 8 }}>Privacy & Confidentiality</div>
          <div className="muted">Protect user data and keep your product development private with our secure testing environment.</div>
        </div>
      </div>

      {/* How it works */}
      <h2 style={{ textAlign: 'center', fontSize: 32, fontWeight: 900, margin: '36px 0 8px' }}>How it works</h2>
      <p className="muted" style={{ textAlign: 'center', marginBottom: 18 }}>Stop waiting weeks for feedback. Start testing in seconds.</p>

      <div style={{ display: 'grid', gap: 16 }}>
        <div className="step">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <span className="step-num">01</span>
            <div style={{ fontWeight: 800, fontSize: 22 }}>Setup your Study</div>
          </div>
          <div className="muted">Upload any prototype or wireframe and define your task. Then, select your audience from a diverse panel of AI‑powered personas.</div>
        </div>

        <div className="step">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <span className="step-num">02</span>
            <div style={{ fontWeight: 800, fontSize: 22 }}>Get Instant AI Analysis</div>
          </div>
          <div className="muted">Run hundreds of tests in minutes and receive your first report highlighting friction points, usability patterns, and key insights.</div>
        </div>

        <div className="step">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <span className="step-num">03</span>
            <div style={{ fontWeight: 800, fontSize: 22 }}>Go Deeper with Real Users</div>
          </div>
          <div className="muted">Launch targeted, AI‑moderated interviews with recruited users to get deep context and authentic feedback.</div>
        </div>

        <div className="step">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <span className="step-num">04</span>
            <div style={{ fontWeight: 800, fontSize: 22 }}>Receive Your Complete Insights</div>
          </div>
          <div className="muted">Get a final, unified report combining the quantitative "what" from AI with the qualitative "why" from interviews.</div>
        </div>
      </div>
    </div>
  );
}
