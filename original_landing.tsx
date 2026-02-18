import { Link } from 'react-router-dom'
import {
    Music,
    Book,
    Video,
    Clock,
    Bell,
    Monitor,
    Users,
    Zap,
    Shield,
    Moon,
    Keyboard,
    RefreshCw,
    ChevronRight,
    Play,
    Check,
    Star,
    ArrowRight,
    Menu,
    X,
} from 'lucide-react'
import { useState } from 'react'

// Feature data
const features = [
    {
        icon: Music,
        title: 'Song Management',
        description: 'Create, edit, and organize worship songs with verse/chorus structure. Build your church\'s song library with ease.',
        gradient: 'from-purple-500 to-pink-500',
    },
    {
        icon: Book,
        title: 'Bible Display',
        description: 'Search and display Bible verses instantly with multiple translations. Find the perfect scripture for any moment.',
        gradient: 'from-blue-500 to-cyan-500',
    },
    {
        icon: Video,
        title: 'Media Integration',
        description: 'Display images, videos, and stream content from YouTube or Vimeo. Rich media support for dynamic presentations.',
        gradient: 'from-orange-500 to-red-500',
    },
    {
        icon: Clock,
        title: 'Countdown Timers',
        description: 'Create beautiful countdown timers for service start times. Keep your congregation engaged before the service.',
        gradient: 'from-green-500 to-emerald-500',
    },
    {
        icon: Bell,
        title: 'Alerts & Announcements',
        description: 'Display priority alerts and announcements instantly. Keep your congregation informed at the right moment.',
        gradient: 'from-yellow-500 to-orange-500',
    },
    {
        icon: Monitor,
        title: 'Live Output',
        description: 'Separate fullscreen output window for projection. Professional-grade output for any display setup.',
        gradient: 'from-indigo-500 to-purple-500',
    },
]

const technicalFeatures = [
    {
        icon: RefreshCw,
        title: 'Real-time Sync',
        description: 'Changes sync instantly across all connected devices',
    },
    {
        icon: Shield,
        title: 'Offline Support',
        description: 'Continue working offline with automatic sync when reconnected',
    },
    {
        icon: Moon,
        title: 'Dark Mode',
        description: 'Full dark mode support for comfortable viewing',
    },
    {
        icon: Keyboard,
        title: 'Keyboard Shortcuts',
        description: 'Efficient navigation and control for power users',
    },
]

const testimonials = [
    {
        quote: "Selah has transformed how we manage our worship services. The real-time sync means our media team is always on the same page.",
        author: "Pastor Michael A.",
        role: "Worship Director",
        church: "Grace Community Church",
        avatar: "MA",
    },
    {
        quote: "The interface is so intuitive that our volunteers were up and running in minutes. No more complicated software training.",
        author: "Sarah K.",
        role: "Media Ministry Lead",
        church: "New Life Fellowship",
        avatar: "SK",
    },
    {
        quote: "Finally, a presentation tool built for churches. The Bible integration and song management features are exactly what we needed.",
        author: "David O.",
        role: "Technical Director",
        church: "Harvest Church",
        avatar: "DO",
    },
]

const stats = [
    { value: '500+', label: 'Churches' },
    { value: '10K+', label: 'Services' },
    { value: '50K+', label: 'Slides Created' },
    { value: '99.9%', label: 'Uptime' },
]

export default function Landing() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

    return (
        <div className="min-h-screen bg-white dark:bg-gray-950 overflow-hidden">
            {/* Navigation */}
            <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-gray-950/80 backdrop-blur-lg border-b border-gray-200/50 dark:border-gray-800/50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16">
                        {/* Logo */}
                        <Link to="/" className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-lg shadow-primary-500/25">
                                <Music className="w-5 h-5 text-white" />
                            </div>
                            <span className="text-xl font-bold text-gray-900 dark:text-white">Selah</span>
                        </Link>

                        {/* Desktop Navigation */}
                        <div className="hidden md:flex items-center gap-8">
                            <a href="#features" className="text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
                                Features
                            </a>
                            <a href="#testimonials" className="text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
                                Testimonials
                            </a>
                            <a href="#pricing" className="text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
                                Pricing
                            </a>
                        </div>

                        {/* CTA Buttons */}
                        <div className="hidden md:flex items-center gap-4">
                            <Link
                                to="/login"
                                className="text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 font-medium transition-colors"
                            >
                                Sign In
                            </Link>
                            <Link
                                to="/signup"
                                className="px-5 py-2.5 bg-gradient-to-r from-primary-600 to-primary-500 text-white font-medium rounded-xl hover:from-primary-700 hover:to-primary-600 transition-all shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40"
                            >
                                Get Started Free
                            </Link>
                        </div>

                        {/* Mobile menu button */}
                        <button
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            className="md:hidden p-2 text-gray-600 dark:text-gray-300"
                        >
                            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                        </button>
                    </div>
                </div>

                {/* Mobile menu */}
                {mobileMenuOpen && (
                    <div className="md:hidden bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800">
                        <div className="px-4 py-4 space-y-3">
                            <a href="#features" className="block py-2 text-gray-600 dark:text-gray-300">Features</a>
                            <a href="#testimonials" className="block py-2 text-gray-600 dark:text-gray-300">Testimonials</a>
                            <a href="#pricing" className="block py-2 text-gray-600 dark:text-gray-300">Pricing</a>
                            <div className="pt-4 border-t border-gray-200 dark:border-gray-800 space-y-3">
                                <Link to="/login" className="block py-2 text-gray-600 dark:text-gray-300">Sign In</Link>
                                <Link to="/signup" className="block w-full py-3 bg-primary-600 text-white text-center font-medium rounded-xl">
                                    Get Started Free
                                </Link>
                            </div>
                        </div>
                    </div>
                )}
            </nav>

            {/* Hero Section */}
            <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-32 overflow-hidden">
                {/* Background Effects */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary-50/50 via-white to-purple-50/50 dark:from-gray-950 dark:via-gray-950 dark:to-gray-950" />
                <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary-400/20 rounded-full blur-3xl animate-blob" />
                <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-purple-400/20 rounded-full blur-3xl animate-blob animation-delay-2000" />
                <div className="absolute bottom-1/4 left-1/3 w-96 h-96 bg-pink-400/20 rounded-full blur-3xl animate-blob animation-delay-4000" />

                {/* Grid Pattern */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:24px_24px]" />

                <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center max-w-4xl mx-auto">
                        {/* Badge */}
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-sm font-medium mb-8 animate-fade-in-up">
                            <Zap className="w-4 h-4" />
                            <span>Built for modern churches</span>
                            <ChevronRight className="w-4 h-4" />
                        </div>

                        {/* Headline */}
                        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-gray-900 dark:text-white mb-6 leading-tight animate-fade-in-up animation-delay-100">
                            Worship Presentation,
                            <br />
                            <span className="bg-gradient-to-r from-primary-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
                                Reimagined
                            </span>
                        </h1>

                        {/* Subheadline */}
                        <p className="text-xl text-gray-600 dark:text-gray-300 mb-10 max-w-2xl mx-auto animate-fade-in-up animation-delay-200">
                            A modern, real-time worship presentation application that helps churches manage and display song lyrics, Bible verses, hymns, and media content during services.
                        </p>

                        {/* CTA Buttons */}
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 animate-fade-in-up animation-delay-300">
                            <Link
                                to="/signup"
                                className="group px-8 py-4 bg-gradient-to-r from-primary-600 to-primary-500 text-white font-semibold rounded-2xl hover:from-primary-700 hover:to-primary-600 transition-all shadow-xl shadow-primary-500/25 hover:shadow-primary-500/40 flex items-center gap-2"
                            >
                                Start Free Trial
                                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </Link>
                            <button className="group px-8 py-4 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-semibold rounded-2xl border border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-600 transition-all flex items-center gap-2 shadow-lg">
                                <Play className="w-5 h-5 text-primary-500" />
                                Watch Demo
                            </button>
                        </div>

                        {/* Stats */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-3xl mx-auto animate-fade-in-up animation-delay-400">
                            {stats.map((stat, index) => (
                                <div key={index} className="text-center">
                                    <div className="text-3xl font-bold text-gray-900 dark:text-white mb-1">{stat.value}</div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">{stat.label}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Hero Image / App Preview */}
                    <div className="mt-20 relative animate-fade-in-up animation-delay-500">
                        <div className="absolute inset-0 bg-gradient-to-t from-white dark:from-gray-950 via-transparent to-transparent z-10 pointer-events-none" />
                        <div className="relative mx-auto max-w-5xl">
                            <div className="bg-gray-900 dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden border border-gray-800">
                                {/* Window Header */}
                                <div className="flex items-center gap-2 px-4 py-3 bg-gray-800 dark:bg-gray-900 border-b border-gray-700">
                                    <div className="flex gap-2">
                                        <div className="w-3 h-3 rounded-full bg-red-500" />
                                        <div className="w-3 h-3 rounded-full bg-yellow-500" />
                                        <div className="w-3 h-3 rounded-full bg-green-500" />
                                    </div>
                                    <div className="flex-1 text-center text-sm text-gray-400">Selah - Dashboard</div>
                                </div>
                                {/* App Content Preview */}
                                <div className="aspect-video bg-gradient-to-br from-gray-900 to-gray-800 p-6">
                                    <div className="grid grid-cols-4 gap-4 h-full">
                                        {/* Sidebar */}
                                        <div className="col-span-1 bg-gray-800/50 rounded-xl p-4 space-y-3">
                                            <div className="h-8 bg-primary-500/20 rounded-lg" />
                                            <div className="h-6 bg-gray-700/50 rounded-lg" />
                                            <div className="h-6 bg-gray-700/50 rounded-lg" />
                                            <div className="h-6 bg-gray-700/50 rounded-lg" />
                                            <div className="h-6 bg-gray-700/50 rounded-lg" />
                                        </div>
                                        {/* Main Content */}
                                        <div className="col-span-2 bg-gray-800/50 rounded-xl p-4">
                                            <div className="h-full flex flex-col">
                                                <div className="h-8 bg-gray-700/50 rounded-lg mb-4 w-1/2" />
                                                <div className="flex-1 grid grid-cols-2 gap-3">
                                                    {[1, 2, 3, 4].map((i) => (
                                                        <div key={i} className="bg-gradient-to-br from-primary-500/10 to-purple-500/10 rounded-lg p-3 border border-primary-500/20">
                                                            <div className="h-3 bg-gray-600/50 rounded mb-2 w-3/4" />
                                                            <div className="h-2 bg-gray-700/50 rounded mb-1" />
                                                            <div className="h-2 bg-gray-700/50 rounded w-5/6" />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                        {/* Preview Panel */}
                                        <div className="col-span-1 bg-gray-800/50 rounded-xl p-4">
                                            <div className="h-full flex flex-col">
                                                <div className="h-6 bg-gray-700/50 rounded-lg mb-3 w-2/3" />
                                                <div className="flex-1 bg-gradient-to-br from-primary-600/20 to-purple-600/20 rounded-lg flex items-center justify-center">
                                                    <div className="text-center">
                                                        <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-primary-500/20 flex items-center justify-center">
                                                            <Play className="w-6 h-6 text-primary-400" />
                                                        </div>
                                                        <div className="text-xs text-gray-400">Preview</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section id="features" className="py-24 bg-gray-50 dark:bg-gray-900/50 relative overflow-hidden">
                {/* Background decoration */}
                <div className="absolute top-1/2 left-0 w-72 h-72 bg-primary-500/10 rounded-full blur-3xl -translate-x-1/2" />
                <div className="absolute bottom-0 right-0 w-72 h-72 bg-purple-500/10 rounded-full blur-3xl translate-x-1/2" />

                <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    {/* Section Header */}
                    <div className="text-center max-w-3xl mx-auto mb-16">
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-sm font-medium mb-4">
                            <Zap className="w-4 h-4" />
                            <span>Powerful Features</span>
                        </div>
                        <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-6">
                            Everything you need for
                            <br />
                            <span className="bg-gradient-to-r from-primary-600 to-purple-600 bg-clip-text text-transparent">
                                seamless services
                            </span>
                        </h2>
                        <p className="text-lg text-gray-600 dark:text-gray-300">
                            From song lyrics to Bible verses, countdowns to media - Selah has all the tools your media ministry needs.
                        </p>
                    </div>

                    {/* Features Grid */}
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {features.map((feature, index) => (
                            <div
                                key={index}
                                className="group relative bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-lg shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-700 hover:border-primary-200 dark:hover:border-primary-800 transition-all duration-300 hover:-translate-y-1"
                            >
                                {/* Icon */}
                                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center mb-6 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                                    <feature.icon className="w-7 h-7 text-white" />
                                </div>

                                {/* Content */}
                                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                                    {feature.title}
                                </h3>
                                <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                                    {feature.description}
                                </p>

                                {/* Hover gradient */}
                                <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-5 rounded-2xl transition-opacity duration-300`} />
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Technical Features Banner */}
            <section className="py-16 bg-gradient-to-r from-primary-600 via-purple-600 to-pink-600 relative overflow-hidden">
                {/* Animated background */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff10_1px,transparent_1px),linear-gradient(to_bottom,#ffffff10_1px,transparent_1px)] bg-[size:24px_24px]" />

                <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
                        {technicalFeatures.map((feature, index) => (
                            <div key={index} className="flex items-start gap-4">
                                <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                                    <feature.icon className="w-6 h-6 text-white" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-white mb-1">{feature.title}</h3>
                                    <p className="text-white/70 text-sm">{feature.description}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* How It Works Section */}
            <section className="py-24 bg-white dark:bg-gray-950">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    {/* Section Header */}
                    <div className="text-center max-w-3xl mx-auto mb-16">
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-sm font-medium mb-4">
                            <RefreshCw className="w-4 h-4" />
                            <span>Simple Workflow</span>
                        </div>
                        <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-6">
                            How it works
                        </h2>
                        <p className="text-lg text-gray-600 dark:text-gray-300">
                            Get started in minutes with our intuitive workflow
                        </p>
                    </div>

                    {/* Steps */}
                    <div className="grid md:grid-cols-3 gap-8 relative">
                        {/* Connection line */}
                        <div className="hidden md:block absolute top-24 left-1/4 right-1/4 h-0.5 bg-gradient-to-r from-primary-500 via-purple-500 to-pink-500" />

                        {[
                            {
                                step: '01',
                                title: 'Create Your Church',
                                description: 'Sign up and create your church workspace. Invite team members with a simple invite code.',
                                icon: Users,
                            },
                            {
                                step: '02',
                                title: 'Build Your Library',
                                description: 'Add songs, hymns, Bible verses, and media. Organize everything for quick access during services.',
                                icon: Music,
                            },
                            {
                                step: '03',
                                title: 'Go Live',
                                description: 'Select slides, preview output, and go live. Real-time sync keeps everyone on the same page.',
                                icon: Monitor,
                            },
                        ].map((item, index) => (
                            <div key={index} className="relative text-center">
                                {/* Step number */}
                                <div className="relative inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-primary-500 to-purple-500 text-white text-2xl font-bold mb-6 shadow-xl shadow-primary-500/25">
                                    {item.step}
                                </div>

                                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                                    {item.title}
                                </h3>
                                <p className="text-gray-600 dark:text-gray-300 max-w-sm mx-auto">
                                    {item.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Testimonials Section */}
            <section id="testimonials" className="py-24 bg-gray-50 dark:bg-gray-900/50 relative overflow-hidden">
                {/* Background decoration */}
                <div className="absolute top-0 right-0 w-96 h-96 bg-primary-500/5 rounded-full blur-3xl" />
                <div className="absolute bottom-0 left-0 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />

                <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    {/* Section Header */}
                    <div className="text-center max-w-3xl mx-auto mb-16">
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-sm font-medium mb-4">
                            <Star className="w-4 h-4" />
                            <span>Loved by Churches</span>
                        </div>
                        <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-6">
                            What ministry teams are saying
                        </h2>
                        <p className="text-lg text-gray-600 dark:text-gray-300">
                            Join hundreds of churches already using Selah to enhance their worship services.
                        </p>
                    </div>

                    {/* Testimonials Grid */}
                    <div className="grid md:grid-cols-3 gap-8">
                        {testimonials.map((testimonial, index) => (
                            <div
                                key={index}
                                className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-lg shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-700"
                            >
                                {/* Stars */}
                                <div className="flex gap-1 mb-4">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                        <Star key={star} className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                                    ))}
                                </div>

                                {/* Quote */}
                                <blockquote className="text-gray-700 dark:text-gray-300 mb-6 leading-relaxed">
                                    "{testimonial.quote}"
                                </blockquote>

                                {/* Author */}
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-500 to-purple-500 flex items-center justify-center text-white font-semibold">
                                        {testimonial.avatar}
                                    </div>
                                    <div>
                                        <div className="font-semibold text-gray-900 dark:text-white">{testimonial.author}</div>
                                        <div className="text-sm text-gray-500 dark:text-gray-400">
                                            {testimonial.role} · {testimonial.church}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Pricing Section */}
            <section id="pricing" className="py-24 bg-white dark:bg-gray-950">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    {/* Section Header */}
                    <div className="text-center max-w-3xl mx-auto mb-16">
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-sm font-medium mb-4">
                            <Shield className="w-4 h-4" />
                            <span>Simple Pricing</span>
                        </div>
                        <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-6">
                            Start free, scale as you grow
                        </h2>
                        <p className="text-lg text-gray-600 dark:text-gray-300">
                            No hidden fees. No credit card required. Cancel anytime.
                        </p>
                    </div>

                    {/* Pricing Cards */}
                    <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                        {/* Free Plan */}
                        <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 border border-gray-200 dark:border-gray-700">
                            <div className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">Free</div>
                            <div className="text-4xl font-bold text-gray-900 dark:text-white mb-2">$0</div>
                            <div className="text-gray-500 dark:text-gray-400 mb-6">Forever free</div>

                            <ul className="space-y-3 mb-8">
                                {['1 Church', '3 Team Members', '50 Songs', 'Basic Templates', 'Community Support'].map((feature) => (
                                    <li key={feature} className="flex items-center gap-3 text-gray-600 dark:text-gray-300">
                                        <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                                        {feature}
                                    </li>
                                ))}
                            </ul>

                            <Link
                                to="/signup"
                                className="block w-full py-3 text-center font-semibold rounded-xl border-2 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white hover:border-primary-500 dark:hover:border-primary-500 transition-colors"
                            >
                                Get Started
                            </Link>
                        </div>

                        {/* Pro Plan */}
                        <div className="relative bg-gradient-to-b from-primary-500 to-purple-600 rounded-2xl p-8 text-white shadow-xl shadow-primary-500/25 scale-105">
                            <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-yellow-400 to-orange-400 text-gray-900 text-sm font-semibold rounded-full">
                                Most Popular
                            </div>

                            <div className="text-sm font-semibold text-white/80 mb-2">Pro</div>
                            <div className="text-4xl font-bold mb-2">$29<span className="text-lg font-normal">/mo</span></div>
                            <div className="text-white/70 mb-6">Billed annually</div>

                            <ul className="space-y-3 mb-8">
                                {['Unlimited Churches', 'Unlimited Team Members', 'Unlimited Songs', 'Premium Templates', 'Priority Support', 'Advanced Analytics'].map((feature) => (
                                    <li key={feature} className="flex items-center gap-3">
                                        <Check className="w-5 h-5 text-white flex-shrink-0" />
                                        {feature}
                                    </li>
                                ))}
                            </ul>

                            <Link
                                to="/signup"
                                className="block w-full py-3 text-center font-semibold rounded-xl bg-white text-primary-600 hover:bg-gray-100 transition-colors"
                            >
                                Start Free Trial
                            </Link>
                        </div>

                        {/* Enterprise Plan */}
                        <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 border border-gray-200 dark:border-gray-700">
                            <div className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">Enterprise</div>
                            <div className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Custom</div>
                            <div className="text-gray-500 dark:text-gray-400 mb-6">For large organizations</div>

                            <ul className="space-y-3 mb-8">
                                {['Everything in Pro', 'Custom Branding', 'SSO Integration', 'Dedicated Support', 'SLA Guarantee', 'Custom Features'].map((feature) => (
                                    <li key={feature} className="flex items-center gap-3 text-gray-600 dark:text-gray-300">
                                        <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                                        {feature}
                                    </li>
                                ))}
                            </ul>

                            <button className="block w-full py-3 text-center font-semibold rounded-xl border-2 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white hover:border-primary-500 dark:hover:border-primary-500 transition-colors">
                                Contact Sales
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="py-24 bg-gradient-to-br from-primary-600 via-purple-600 to-pink-600 relative overflow-hidden">
                {/* Animated background */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff10_1px,transparent_1px),linear-gradient(to_bottom,#ffffff10_1px,transparent_1px)] bg-[size:24px_24px]" />

                {/* Floating elements */}
                <div className="absolute top-10 left-10 w-20 h-20 bg-white/10 rounded-full blur-xl animate-float" />
                <div className="absolute bottom-10 right-10 w-32 h-32 bg-white/10 rounded-full blur-xl animate-float animation-delay-2000" />
                <div className="absolute top-1/2 right-1/4 w-16 h-16 bg-white/10 rounded-full blur-xl animate-float animation-delay-4000" />

                <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                    <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
                        Ready to transform your
                        <br />
                        worship services?
                    </h2>
                    <p className="text-xl text-white/80 mb-10 max-w-2xl mx-auto">
                        Join hundreds of churches already using Selah. Start your free trial today - no credit card required.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <Link
                            to="/signup"
                            className="group px-8 py-4 bg-white text-primary-600 font-semibold rounded-2xl hover:bg-gray-100 transition-all shadow-xl flex items-center gap-2"
                        >
                            Get Started Free
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Link>
                        <Link
                            to="/login"
                            className="px-8 py-4 text-white font-semibold rounded-2xl border-2 border-white/30 hover:bg-white/10 transition-all"
                        >
                            Sign In
                        </Link>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="bg-gray-900 dark:bg-gray-950 py-16 border-t border-gray-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid md:grid-cols-4 gap-12 mb-12">
                        {/* Brand */}
                        <div className="md:col-span-1">
                            <Link to="/" className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
                                    <Music className="w-5 h-5 text-white" />
                                </div>
                                <span className="text-xl font-bold text-white">Selah</span>
                            </Link>
                            <p className="text-gray-400 text-sm leading-relaxed">
                                A modern worship presentation application built for churches.
                            </p>
                        </div>

                        {/* Links */}
                        <div>
                            <h4 className="font-semibold text-white mb-4">Product</h4>
                            <ul className="space-y-2">
                                {['Features', 'Pricing', 'Templates', 'Integrations'].map((link) => (
                                    <li key={link}>
                                        <a href="#" className="text-gray-400 hover:text-white transition-colors text-sm">{link}</a>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div>
                            <h4 className="font-semibold text-white mb-4">Resources</h4>
                            <ul className="space-y-2">
                                {['Documentation', 'Tutorials', 'Blog', 'Community'].map((link) => (
                                    <li key={link}>
                                        <a href="#" className="text-gray-400 hover:text-white transition-colors text-sm">{link}</a>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div>
                            <h4 className="font-semibold text-white mb-4">Company</h4>
                            <ul className="space-y-2">
                                {['About', 'Contact', 'Privacy', 'Terms'].map((link) => (
                                    <li key={link}>
                                        <a href="#" className="text-gray-400 hover:text-white transition-colors text-sm">{link}</a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    {/* Bottom */}
                    <div className="pt-8 border-t border-gray-800 flex flex-col md:flex-row items-center justify-between gap-4">
                        <p className="text-gray-400 text-sm">
                            © {new Date().getFullYear()} Selah. All rights reserved.
                        </p>
                        <div className="flex items-center gap-6">
                            <a href="#" className="text-gray-400 hover:text-white transition-colors text-sm">Privacy Policy</a>
                            <a href="#" className="text-gray-400 hover:text-white transition-colors text-sm">Terms of Service</a>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    )
}