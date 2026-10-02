export interface ToggleOption<T extends string> {
  id: T;
  label: string;
}

export function Toggle<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ToggleOption<T>[];
  value: string;
  onChange: (id: T) => void;
}) {
  const at = options.findIndex((option) => option.id === value);
  return (
    <div className="toggle" role="group" aria-label={label}>
      {at === -1 ? null : <span className="toggle-knob" data-at={at} />}
      {options.map(({ id, label: name }) => (
        <button
          key={id}
          type="button"
          className={value === id ? "is-on" : undefined}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
