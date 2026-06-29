/* ImagePlaceholder.jsx — a simple sized image-shaped placeholder used
   to demonstrate that the OmegaWindow system supports content beyond
   text. Real-image content (from an attachment, etc.) would replace
   this in later parts. */

const ImagePlaceholder = function ImagePlaceholder() {
  return (
    <div className="image-content" aria-label="Image placeholder">
      <div className="image-stripes" aria-hidden="true">
        <span className="image-label">image</span>
      </div>
    </div>
  );
};

window.ImagePlaceholder = ImagePlaceholder;
