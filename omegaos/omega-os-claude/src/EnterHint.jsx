/* EnterHint.jsx — faint, italic, slow fade in/out.
   Pure CSS animation; component just renders the markup. */

const EnterHint = function EnterHint() {
  return (
    <div className="hint" aria-hidden="true">
      wake
    </div>
  );
};

window.EnterHint = EnterHint;
