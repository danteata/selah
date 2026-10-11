import { notesForDialog, parseInline } from '../../lib/releaseNotes'

/**
 * Release notes as people read them, not as they're written. The update dialog
 * used to print the Markdown verbatim — `###`, `**` and backticks in front of
 * the operator. The notes are parsed into data (lib/releaseNotes) and rendered
 * as React elements, never HTML: the manifest comes over the network, so
 * nothing in it can become markup.
 */

function Inline({ text }: { text: string }) {
    return (
        <>
            {parseInline(text).map((run, i) =>
                run.bold ? (
                    <strong key={i} className="font-semibold text-[var(--text-primary)]">{run.text}</strong>
                ) : run.code ? (
                    // File types and names: plain words, set slightly apart.
                    <span key={i} className="font-medium text-[var(--text-primary)]">{run.text}</span>
                ) : (
                    run.text
                ),
            )}
        </>
    )
}

export function ReleaseNotes({ markdown, version }: { markdown: string; version: string }) {
    const blocks = notesForDialog(markdown, version)
    return (
        <div className="space-y-3 text-[13px] leading-relaxed text-[var(--text-secondary)]">
            {blocks.map((block, i) => {
                if (block.kind === 'heading') {
                    return (
                        <h3 key={i} className="pt-1 text-xs font-semibold uppercase tracking-wide text-[var(--accent-teal)]">
                            <Inline text={block.text} />
                        </h3>
                    )
                }
                if (block.kind === 'list') {
                    return (
                        <ul key={i} className="space-y-2">
                            {block.items.map((item, j) => (
                                <li key={j} className="flex gap-2">
                                    <span aria-hidden className="mt-[0.55em] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--accent-teal)]/60" />
                                    <span><Inline text={item} /></span>
                                </li>
                            ))}
                        </ul>
                    )
                }
                // The summary line under the title reads as an introduction.
                const lead = i === 0
                return (
                    <p key={i} className={lead ? 'text-sm text-[var(--text-primary)]' : undefined}>
                        <Inline text={block.text} />
                    </p>
                )
            })}
        </div>
    )
}
