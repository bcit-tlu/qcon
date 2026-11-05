// SPDX-License-Identifier: MPL-2.0
// Yellow banners for reviewer markup (tracked changes, comments) found during import.

import type { ImportWarning } from "../model/types.js";

const MAX_DETAILS = 10;

export function ImportWarnings({ warnings }: { warnings: ImportWarning[] }) {
  return (
    <>
      {warnings.map((w) => (
        <div key={w.html} className="import-warning">
          <p dangerouslySetInnerHTML={{ __html: w.html }} />
          {w.details && (
            <ul>
              {w.details.slice(0, MAX_DETAILS).map((d) => (
                <li key={d}>{d}</li>
              ))}
              {w.details.length > MAX_DETAILS && (
                <li>…and {w.details.length - MAX_DETAILS} more</li>
              )}
            </ul>
          )}
        </div>
      ))}
    </>
  );
}
