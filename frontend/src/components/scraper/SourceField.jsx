import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.jsx';

/**
 * Renders one form control from a source descriptor's field definition.
 *
 * This is what makes the scrape form site-agnostic: the backend declares which
 * parameters a directory accepts, and the UI builds the form from that. Adding
 * a website never requires touching this component — only adding a new `type`
 * would.
 *
 * @param {{ field: import('@/api/services/sources.api.js').SourceField, value: unknown, onChange: (name: string, value: unknown) => void, error?: string, disabled?: boolean }} props
 */
export function SourceField({ field, value, onChange, error, disabled }) {
  const inputId = `field-${field.name}`;
  const describedBy = error ? `${inputId}-error` : field.helpText ? `${inputId}-help` : undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>
        {field.label}
        {field.required ? <span className="ml-1 text-destructive">*</span> : null}
      </Label>

      {field.type === 'select' ? (
        <Select
          value={value != null ? String(value) : undefined}
          onValueChange={(next) => onChange(field.name, next)}
          disabled={disabled}
        >
          <SelectTrigger id={inputId} aria-describedby={describedBy}>
            <SelectValue placeholder={field.placeholder ?? 'Select an option'} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={inputId}
          type={field.type === 'number' ? 'number' : 'text'}
          value={value ?? ''}
          min={field.min}
          max={field.max}
          placeholder={field.placeholder}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) => onChange(field.name, event.target.value)}
        />
      )}

      {error ? (
        <p id={`${inputId}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : field.helpText ? (
        <p id={`${inputId}-help`} className="text-xs text-muted-foreground">
          {field.helpText}
        </p>
      ) : null}
    </div>
  );
}

export default SourceField;
