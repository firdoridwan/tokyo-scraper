import { useEffect, useMemo, useState } from 'react';
import { Loader2, PlayCircle, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button.jsx';
import { SectionCard } from '@/components/common/SectionCard.jsx';
import { SourceField } from './SourceField.jsx';

/**
 * Dynamic scrape configuration form.
 *
 * Builds itself entirely from the selected source's `fields` descriptor, so it
 * works unchanged for hipages today and any directory added later.
 *
 * Validation here is presentational only — required/range checks that give
 * instant feedback. The backend re-validates every field; the client is never
 * the authority.
 */
export function ScrapeForm({ source, onSubmit, isSubmitting }) {
  const fields = useMemo(() => source?.fields ?? [], [source]);

  const initialValues = useMemo(() => {
    const values = {};
    for (const field of fields) values[field.name] = field.defaultValue ?? '';
    return values;
  }, [fields]);

  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});

  // Switching source replaces the whole form model.
  useEffect(() => {
    setValues(initialValues);
    setErrors({});
  }, [initialValues]);

  const handleChange = (name, value) => {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const validate = () => {
    const nextErrors = {};

    for (const field of fields) {
      const value = values[field.name];
      const isEmpty = value === '' || value === undefined || value === null;

      if (field.required && isEmpty) {
        nextErrors[field.name] = `${field.label} is required`;
        continue;
      }
      if (isEmpty || field.type !== 'number') continue;

      const numeric = Number(value);
      if (Number.isNaN(numeric)) {
        nextErrors[field.name] = `${field.label} must be a number`;
      } else if (field.min !== undefined && numeric < field.min) {
        nextErrors[field.name] = `Minimum is ${field.min}`;
      } else if (field.max !== undefined && numeric > field.max) {
        nextErrors[field.name] = `Maximum is ${field.max}`;
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!validate()) return;

    // Strip empty optionals so the backend applies its own defaults.
    const params = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value !== '' && value !== null),
    );

    onSubmit({ sourceId: source.id, params });
  };

  const handleReset = () => {
    setValues(initialValues);
    setErrors({});
  };

  if (!source) return null;

  return (
    <form onSubmit={handleSubmit}>
      <SectionCard
        title="Extraction Parameters"
        description={`Configure what to extract from ${source.name}.`}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          {fields.map((field) => (
            <SourceField
              key={field.name}
              field={field}
              value={values[field.name]}
              onChange={handleChange}
              error={errors[field.name]}
              disabled={isSubmitting}
            />
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="animate-spin" /> : <PlayCircle />}
            {isSubmitting ? 'Starting…' : 'Start Scraping'}
          </Button>

          <Button type="button" variant="ghost" onClick={handleReset} disabled={isSubmitting}>
            <RotateCcw />
            Reset
          </Button>

          <p className="ml-auto text-xs text-muted-foreground">
            Extracts publicly listed business information only.
          </p>
        </div>
      </SectionCard>
    </form>
  );
}

export default ScrapeForm;
