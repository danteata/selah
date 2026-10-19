import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({
    signIn: {
        create: vi.fn(),
        prepareSecondFactor: vi.fn(async () => ({})),
        attemptSecondFactor: vi.fn(),
        supportedSecondFactors: [{ strategy: 'email_code', emailAddressId: 'idn_1', safeIdentifier: 'c***@church.org' }],
    },
    setActive: vi.fn(async () => {}),
    upsertUser: vi.fn(async () => {}),
    navigate: vi.fn(),
}))

vi.mock('@clerk/clerk-react', () => ({
    useSignIn: () => ({ signIn: h.signIn, isLoaded: true, setActive: h.setActive }),
    useClerk: () => ({ user: { id: 'user_1' } }),
}))
vi.mock('convex/react', () => ({ useMutation: () => h.upsertUser }))
vi.mock('../../../hooks', () => ({ useAnalytics: () => ({ trackEvent: vi.fn(), trackPage: vi.fn() }) }))
vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-router-dom')>()),
    useNavigate: () => h.navigate,
}))

import LoginPage from '../Login'

function signInWithPassword() {
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    fireEvent.change(screen.getByPlaceholderText('you@church.com'), { target: { value: 'cara@church.org' } })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'secret-pass' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign In/ }))
}

describe('LoginPage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('signs straight in when the password is enough', async () => {
        h.signIn.create.mockResolvedValue({ status: 'complete', createdSessionId: 'sess_1' })
        signInWithPassword()
        await waitFor(() => expect(h.setActive).toHaveBeenCalledWith({ session: 'sess_1' }))
        expect(h.navigate).toHaveBeenCalledWith('/')
    })

    it('asks for the emailed code on a new device, then signs in', async () => {
        // It used to log "needs additional steps" and leave the form as it was.
        h.signIn.create.mockResolvedValue({ status: 'needs_second_factor' })
        h.signIn.attemptSecondFactor.mockResolvedValue({ status: 'complete', createdSessionId: 'sess_2' })
        signInWithPassword()

        const code = await screen.findByLabelText('Sign-in code')
        expect(h.signIn.prepareSecondFactor).toHaveBeenCalledWith({ strategy: 'email_code', emailAddressId: 'idn_1' })
        expect(screen.getByText('c***@church.org')).toBeInTheDocument()

        fireEvent.change(code, { target: { value: '424242' } })
        fireEvent.click(screen.getByRole('button', { name: /Sign In/ }))
        await waitFor(() => expect(h.setActive).toHaveBeenCalledWith({ session: 'sess_2' }))
        expect(h.signIn.attemptSecondFactor).toHaveBeenCalledWith({ strategy: 'email_code', code: '424242' })
    })

    it('says so when Clerk wants a step this page has no form for', async () => {
        h.signIn.create.mockResolvedValue({ status: 'needs_new_password' })
        signInWithPassword()
        expect(await screen.findByText(/needs another sign-in step/)).toBeInTheDocument()
    })
})
