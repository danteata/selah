import { useMemo } from 'react'
import { IconWrapper } from './IconWrapper'
import clsx from 'clsx'

interface EmptyStateProps {
    icon: string
    sub: string
    desc?: string
    actionText?: string
    action?: () => void
    isWider?: boolean
}

export function EmptyState({
    icon,
    sub,
    desc,
    actionText,
    action,
    isWider = false
}: EmptyStateProps) {
    const actionIcon = useMemo(() => {
        if (actionText?.toLowerCase().includes('create') ||
            actionText?.toLowerCase().includes('add')) {
            return 'i-bx-plus'
        }
        return ''
    }, [actionText])

    return (
        <div className="h-[88%] mt-4 flex flex-col items-center justify-center gap-4 text-gray-500">
            <IconWrapper name={icon} size="14" />
            <div>
                <h2 className={clsx(
                    'text-md font-semibold max-w-[150px] text-center mx-auto',
                    isWider && 'max-w-[200px]'
                )}>
                    {sub}
                </h2>
                {desc && (
                    <p className={clsx(
                        'text-xs max-w-[150px] text-center mt-1 mx-auto',
                        isWider && 'max-w-[220px]'
                    )}>
                        {desc}
                    </p>
                )}
            </div>

            {action && actionText && (
                <button
                    onClick={action}
                    className="flex items-center gap-2 px-4 py-2 bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 transition-all shadow-sm"
                >
                    {actionIcon && <IconWrapper name={actionIcon} size="4" />}
                    {actionText}
                </button>
            )}
        </div>
    )
}
