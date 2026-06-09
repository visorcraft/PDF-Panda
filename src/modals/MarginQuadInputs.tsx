export type MarginValues = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type MarginQuadInputsProps = {
  margins: MarginValues;
  onChange: (margins: MarginValues) => void;
};

const parseMargin = (value: string) => Math.max(0, parseInt(value, 10) || 0);

export function MarginQuadInputs({ margins, onChange }: MarginQuadInputsProps) {
  return (
    <>
      <label>
        Top:
        {' '}
        <input
          type="number"
          value={margins.top}
          onChange={(e) => onChange({ ...margins, top: parseMargin(e.target.value) })}
          min="0"
          className="modal-input"
        />
      </label>
      <label>
        Right:
        {' '}
        <input
          type="number"
          value={margins.right}
          onChange={(e) => onChange({ ...margins, right: parseMargin(e.target.value) })}
          min="0"
          className="modal-input"
        />
      </label>
      <label>
        Bottom:
        {' '}
        <input
          type="number"
          value={margins.bottom}
          onChange={(e) => onChange({ ...margins, bottom: parseMargin(e.target.value) })}
          min="0"
          className="modal-input"
        />
      </label>
      <label>
        Left:
        {' '}
        <input
          type="number"
          value={margins.left}
          onChange={(e) => onChange({ ...margins, left: parseMargin(e.target.value) })}
          min="0"
          className="modal-input"
        />
      </label>
    </>
  );
}
