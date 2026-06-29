/* ReasoningReceipt.jsx — the mathematical RECEIPT for a reasoning hop
   (Evolution Plan §11). OmegaClaw's differentiator: every conclusion
   comes with exactly how confident it is and what evidence supports it.

   This is the drill-to-exact VIEW that accompanies the spatial play in
   the chamber (premise atoms gathering links into a derived conclusion).
   It synthesises a canonical NAL deduction with decay from the chosen
   premise/conclusion labels; when the live loop is wired, the real
   `(stv f c)` values stream in here unchanged.

   Truth functions (NAL deduction):
     f = f1·f2
     c = c1·c2·f1·f2          (confidence decays each hop ~ one of the
                               reasons "c<0.5 by hop 3")
     expectation = c·(f−0.5)+0.5
   Verdict thresholds: ACT (f≥0.6 ∧ c≥0.5) · HYPOTHESIZE (f≥0.3 ∧ c≥0.2)
   · else IGNORE. */

(function () {
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  /* Deterministic per-label stv so the same atom reads consistently. */
  function seededStv(label, i) {
    let h = 2166136261 >>> 0;
    const s = String(label) + ":" + i;
    for (let c = 0; c < s.length; c++) { h ^= s.charCodeAt(c); h = Math.imul(h, 16777619); }
    const a = ((h >>> 8) & 0xff) / 255, b = ((h >>> 16) & 0xff) / 255;
    return { f: 0.74 + a * 0.22, c: 0.66 + b * 0.26 };   // premises: high-ish f, solid c
  }

  function TwinBars({ stv }) {
    const fp = Math.round(clamp01(stv.f) * 100);
    const cp = Math.round(clamp01(stv.c) * 100);
    return (
      <div className="rcpt-stv">
        <div className="rcpt-stv-row">
          <span className="rcpt-stv-k">f</span>
          <div className="insp-bar"><div className="insp-bar-fill" style={{ width: fp + "%" }}></div></div>
          <span className="rcpt-stv-v">{stv.f.toFixed(2)}</span>
        </div>
        <div className="rcpt-stv-row">
          <span className="rcpt-stv-k">c</span>
          <div className="insp-bar"><div className="insp-bar-fill conf" style={{ width: cp + "%" }}></div></div>
          <span className="rcpt-stv-v">{stv.c.toFixed(2)}</span>
        </div>
      </div>
    );
  }

  function ReasoningReceiptBody({ payload }) {
    const p = payload || {};
    const premises = (p.premises && p.premises.length ? p.premises : ["premise α", "premise β"]).slice(0, 8);
    const conclusion = p.conclusion || "conclusion";

    /* Premise stv + the deduction chain (fold premises left→right). */
    const pstv = premises.map((lab, i) => seededStv(lab, i));
    let f = pstv[0].f, c = pstv[0].c;
    for (let i = 1; i < pstv.length; i++) { f = f * pstv[i].f; c = c * pstv[i].c * pstv[i].f; }
    const conc = { f: clamp01(f), c: clamp01(c) };
    const expectation = clamp01(conc.c * (conc.f - 0.5) + 0.5);
    const verdict = (conc.f >= 0.6 && conc.c >= 0.5) ? "ACT"
                  : (conc.f >= 0.3 && conc.c >= 0.2) ? "HYPOTHESIZE" : "IGNORE";
    const decayPct = pstv.length > 1 ? Math.round((1 - conc.c / pstv[0].c) * 100) : 0;

    return (
      <div className="insp rcpt">
        <div className="insp-head">
          <span className="insp-kind">reasoning · |&minus;</span>
          <span className="insp-name">deduction</span>
        </div>
        <div className="insp-scroll">
          {/* Premises */}
          <div className="rcpt-sec-label">premises &middot; {premises.length}</div>
          {premises.map((lab, i) => (
            <div className="rcpt-prem" key={i}>
              <div className="rcpt-prem-head">
                <span className="rcpt-atom">{lab}</span>
                <span className="rcpt-prov">&amp;beliefs</span>
              </div>
              <TwinBars stv={pstv[i]} />
            </div>
          ))}

          {/* Rule */}
          <div className="rcpt-rule">
            <span className="rcpt-rule-engine">NAL &middot; |&minus;</span>
            <span className="rcpt-rule-fn">deduction &nbsp;f=f&#8321;&middot;f&#8322; &nbsp;c=c&#8321;c&#8322;f&#8321;f&#8322;</span>
          </div>

          {/* Conclusion */}
          <div className="rcpt-sec-label">conclusion</div>
          <div className="rcpt-conc">
            <div className="rcpt-prem-head">
              <span className="rcpt-atom hot">{conclusion}</span>
              <span className={"rcpt-verdict " + verdict.toLowerCase()}>{verdict}</span>
            </div>
            <TwinBars stv={conc} />
            <div className="rcpt-exp">
              <span>expectation</span>
              <span className="rcpt-exp-v">{expectation.toFixed(2)}</span>
            </div>
            {pstv.length > 1 ? (
              <div className="insp-note">confidence decayed ~{decayPct}% from the strongest premise &middot; c&lt;0.5 by ~hop {Math.max(2, Math.ceil(0.5 / Math.max(0.01, conc.c) ))}</div>
            ) : null}
          </div>
        </div>
        <div className="insp-src">
          exact trace on disk &middot; this is a view &middot; GIGO: a conclusion is only as sound as its premises
        </div>
      </div>
    );
  }

  window.ReasoningReceiptBody = ReasoningReceiptBody;
})();
