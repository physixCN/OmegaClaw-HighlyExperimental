/* ContentPlaceholder.jsx — a labelled stripey placeholder used to
   stand in for any rich content kind (video, song, document, browser,
   etc.). Real content components would replace this in later parts. */

const ContentPlaceholder = function ContentPlaceholder({ label, hue = 215 }) {
  const stripeA = `oklch(0.26 0.045 ${hue})`;
  const stripeB = `oklch(0.21 0.050 ${hue})`;
  const style = {
    background: `repeating-linear-gradient(
      45deg,
      ${stripeA} 0px, ${stripeA} 8px,
      ${stripeB} 8px, ${stripeB} 16px
    )`,
  };
  return (
    <div className="image-content" aria-label={label}>
      <div className="image-stripes" style={style}>
        <span className="image-label">{label}</span>
      </div>
    </div>
  );
};

window.ContentPlaceholder = ContentPlaceholder;
