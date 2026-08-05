import { Ban, CheckCircle2, Download, Loader2, TriangleAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Progress } from '@/components/ui/progress.jsx';
import { resultsApi } from '@/api/services/results.api.js';
import { JOB_STATUS } from '@/lib/constants.js';

/**
 * Live state of the job the user just started.
 *
 * The backend accepts a job and runs it in the background, so this panel is the
 * whole story of a run: it is fed a job record that the page re-reads every two
 * seconds, and renders whichever of the five states that record is in.
 *
 * It holds no timer and no state of its own. Polling belongs to the hook that
 * owns the request; this component only draws what it is handed, which is what
 * keeps "when do we stop asking?" a single decision in a single place.
 *
 * The backend's `message` is rendered verbatim in every state. It already says
 * things like "Running — 12 companies checked, 5 emails found." and "Hipages
 * has no more companies. 31 emails were collected from 100 companies checked."
 * — re-deriving that sentence here would give the UI a second opinion about
 * what the run is doing.
 *
 * What the run is counted in
 * --------------------------
 * The goal is emails, so emails lead. A company with no website, or with no
 * address on the website it has, is checked and dropped; it is not an error and
 * gets no counter of its own. Three numbers describe the run — how many emails
 * were collected, how many companies that took, and how many broke.
 *
 * A run that empties hipages before reaching the target completes normally, at
 * 100%, in the success state. It collected everything there was to collect,
 * which is the job done rather than the job failed; the message explains the
 * ending.
 */

/** One counter from the run. */
function Counter({ label, value }) {
  return (
    <div className="rounded-md border border-border bg-secondary/40 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-lg text-foreground">{value}</dd>
    </div>
  );
}

/**
 * The three counters, in goal-first order.
 *
 * Emails found is shown against the target when the job carries one, because
 * "31" alone does not say whether the run is a third of the way through or
 * finished. The target comes off the job's own params, so it is whatever was
 * actually requested rather than a constant duplicated in the frontend.
 *
 * @param {{ job: object }} props
 */
function Counters({ job }) {
  const summary = job.summary ?? {};
  const target = Number(job.params?.limit) > 0 ? Number(job.params.limit) : null;
  const found = summary.emailsFound ?? 0;

  return (
    <dl className="grid grid-cols-3 gap-2">
      <Counter label="Emails found" value={target ? `${found} / ${target}` : found} />
      <Counter label="Companies checked" value={summary.processed ?? 0} />
      <Counter label="Failed" value={summary.failed ?? 0} />
    </dl>
  );
}

/**
 * @param {{ job: object, error?: unknown }} props `job` is the polled record.
 */
export function JobProgress({ job, error }) {
  if (!job) return null;

  const isQueued = job.status === JOB_STATUS.QUEUED;
  const isRunning = job.status === JOB_STATUS.RUNNING;

  // ── Queued ────────────────────────────────────────────────────────────────
  if (isQueued) {
    return (
      <Alert variant="info">
        <Loader2 className="animate-spin" />
        <AlertTitle>Waiting to start...</AlertTitle>
        <AlertDescription>
          <p className="font-mono text-xs">{job.id}</p>
        </AlertDescription>
      </Alert>
    );
  }

  // ── Running ───────────────────────────────────────────────────────────────
  if (isRunning) {
    return (
      <Alert variant="info">
        <Loader2 className="animate-spin" />
        <AlertTitle>Scraping in progress</AlertTitle>
        <AlertDescription className="space-y-4">
          <p>{job.message}</p>

          <div className="space-y-1.5">
            <Progress value={job.progress ?? 0} />
            <p className="text-right font-mono text-xs text-muted-foreground">
              {job.progress ?? 0}%
            </p>
          </div>

          <Counters job={job} />

          {/* A dropped poll is not a dropped run — say so rather than going quiet. */}
          {error ? (
            <p className="text-xs text-warning">
              Lost contact with the API — still retrying. The scrape keeps running.
            </p>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  // ── Failed ────────────────────────────────────────────────────────────────
  if (job.status === JOB_STATUS.FAILED) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Scrape failed</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{job.error ?? job.message}</p>
          <p className="font-mono text-xs text-muted-foreground">{job.id}</p>
        </AlertDescription>
      </Alert>
    );
  }

  // ── Cancelled ─────────────────────────────────────────────────────────────
  if (job.status === JOB_STATUS.CANCELLED) {
    return (
      <Alert variant="warning">
        <Ban />
        <AlertTitle>Job cancelled.</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{job.message}</p>
          <p className="font-mono text-xs text-muted-foreground">{job.id}</p>
        </AlertDescription>
      </Alert>
    );
  }

  // ── Completed ─────────────────────────────────────────────────────────────
  // One success state, both endings. Whether the run stopped because it reached
  // the target or because hipages ran out, it finished and produced a file; the
  // message is what tells them apart.
  return (
    <Alert variant="success">
      <CheckCircle2 />
      <AlertTitle>Scrape complete</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{job.message}</p>

        <Counters job={job} />

        {job.export?.files?.xlsx ? (
          <p>
            Excel file:{' '}
            <span className="font-mono text-xs text-foreground">{job.export.files.xlsx}</span>
          </p>
        ) : null}
        {job.export?.fileName ? (
          <p>
            CSV file:{' '}
            <span className="font-mono text-xs text-foreground">{job.export.fileName}</span>
          </p>
        ) : null}

        {/* Plain links: the browser downloads the files itself. Excel leads;
            CSV sits under it as the secondary option. */}
        {job.export?.files?.xlsx ? (
          <div>
            <Button asChild size="sm">
              <a href={resultsApi.downloadUrl(job.id, 'xlsx')} download>
                <Download />
                Download Excel
              </a>
            </Button>
          </div>
        ) : null}
        {job.export?.fileName ? (
          <div>
            <Button asChild size="sm" variant="outline">
              <a href={resultsApi.downloadUrl(job.id, 'csv')} download>
                <Download />
                Download CSV
              </a>
            </Button>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export default JobProgress;
