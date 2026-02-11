import { useNavigate } from 'react-router-dom'

function TestPage() {
    const navigate = useNavigate()

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
            <h1 className="text-3xl font-bold text-gray-800 mb-4">Test Page</h1>
            <p className="text-gray-600 mb-8">This is a test page to verify routing functionality</p>

            <div className="space-x-4">
                <button
                    onClick={() => navigate('/')}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                >
                    Go to Home
                </button>
                <button
                    onClick={() => navigate('/login')}
                    className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
                >
                    Go to Login
                </button>
                <button
                    onClick={() => navigate('/signup')}
                    className="px-4 py-2 bg-purple-500 text-white rounded-md hover:bg-purple-600"
                >
                    Go to Signup
                </button>
                <button
                    onClick={() => navigate('/dashboard')}
                    className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600"
                >
                    Go to Dashboard
                </button>
            </div>
        </div>
    )
}

export default TestPage
