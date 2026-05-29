import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { IconWrapper } from '../IconWrapper'

describe('IconWrapper', () => {
    it('renders with default size', () => {
        const { container } = render(<IconWrapper name="i-bx-plus" />)
        expect(container.querySelector('svg')).toBeTruthy()
    })

    it('renders with custom size', () => {
        const { container } = render(<IconWrapper name="i-bx-plus" size={8} />)
        expect(container.querySelector('svg')).toBeTruthy()
    })

    it('renders with string size', () => {
        const { container } = render(<IconWrapper name="i-bx-plus" size="10" />)
        expect(container.querySelector('svg')).toBeTruthy()
    })

    it('uses Activity as fallback for unknown icon', () => {
        const { container } = render(<IconWrapper name="i-unknown" />)
        expect(container.querySelector('svg')).toBeTruthy()
    })

    it('applies roundedBg class when set', () => {
        const { container } = render(<IconWrapper name="i-bx-plus" roundedBg />)
        expect(container.firstChild).toHaveClass('icon-bg')
    })

    it('does not apply roundedBg when false', () => {
        const { container } = render(<IconWrapper name="i-bx-plus" />)
        expect(container.firstChild).not.toHaveClass('icon-bg')
    })

    it('applies custom className', () => {
        const { container } = render(<IconWrapper name="i-bx-plus" className="my-class" />)
        expect(container.firstChild).toHaveClass('my-class')
    })

    it('applies animate-ping when animate is true', () => {
        const { container } = render(<IconWrapper name="i-bx-plus" animate />)
        expect(container.querySelector('svg')).toHaveClass('animate-ping')
    })

    it('maps known icons correctly', () => {
        const knownIcons = [
            'i-bx-plus', 'i-bx-file', 'i-bx-music', 'i-bx-users',
            'i-bx-cog', 'i-bx-search', 'i-bx-x', 'i-bx-check',
        ]
        knownIcons.forEach((name) => {
            const { container } = render(<IconWrapper name={name} />)
            expect(container.querySelector('svg')).toBeTruthy()
        })
    })
})
