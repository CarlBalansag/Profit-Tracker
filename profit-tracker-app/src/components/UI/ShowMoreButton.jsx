// Ends a list that usePhoneList has shortened.
const ShowMoreButton = ({ hiddenCount, step = 25, onClick, className = '' }) => {
  if (hiddenCount <= 0) return null;
  return (
    <button type="button" onClick={onClick} className={`page-btn page-btn-secondary w-full justify-center ${className}`}>
      Show {Math.min(step, hiddenCount)} more ({hiddenCount} left)
    </button>
  );
};

export default ShowMoreButton;
