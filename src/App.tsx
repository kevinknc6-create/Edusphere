import { useEffect, useState, type CSSProperties, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react'
import { ArrowLeft, ArrowRight, Award, BarChart3, Bell, BookOpen, Bookmark, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, CirclePlay, Clock3, Code2, Download, Edit3, Eye, EyeOff, FileText, Flame, Image as ImageIcon, LayoutDashboard, ListChecks, LockKeyhole, LogIn, Menu, Moon, MoreHorizontal, NotebookPen, Play, Plus, RotateCcw, Search, Send, Sparkles, Sun, Target, Timer, Trash2, Trophy, Upload, Users, Video, X } from 'lucide-react'
import './App.css'
import { canAccessAdmin } from './security/authorization'
import { api, getAccessToken, getStoredUser, type ApiCourse, type ApiSession, type EducationProfile, type LearningDashboard, type LearningSummary, type TvetDashboard as TvetDashboardData, type UniversityDashboard as UniversityDashboardData } from './lib/api'
import LoginImpactScene from './components/LoginImpactScene'
import HtmlLoginScreen from './components/HtmlLoginScreen'
import StudentDashboard from './components/StudentDashboard'
import TvetDashboard from './components/TvetDashboard'
import UniversityDashboard from './components/UniversityDashboard'
import EducationOnboarding from './components/EducationOnboarding'
import LearningPath from './components/LearningPath'
import LessonWorkspace from './components/LessonWorkspace'
import TeacherWorkspace from './components/TeacherWorkspace'
import TeacherLoginScreen from './components/TeacherLoginScreen'
import StudentAiTutor from './components/StudentAiTutor'

void Dashboard
void CoursePage
void LessonPage
void SubjectPage
void TeacherPortal

type View = 'dashboard' | 'learning' | 'calendar' | 'achievements' | 'course' | 'lesson' | 'assessment' | 'results' | 'teacher'
type AuthMode = 'login' | 'register'
type AssessmentMode = 'practice' | 'test' | 'exam'
type Question = { id: number; type: 'multiple-choice' | 'true-false' | 'fill-blank' | 'matching' | 'short-answer' | 'programming'; prompt: string; options?: string[]; answer: string; explanation: string }
type AssessmentResult = { mode: AssessmentMode; score: number; correct: number; total: number; completedAt: string; answers: Record<number, string> }
type Course = { id: string | number; title: string; category: string; teacher: string; lessons: number; progress: number; difficulty: string; color: string; icon: string; description: string }
type TeacherCourse = { id: number; title: string; subject: string; students: number; lessons: number; published: boolean; progress: number; color: string }
function hasCompleteEducationProfile(profile: EducationProfile | null) {
    if (!profile?.education_level_id || !profile.school_id || profile.school_status !== 'active') return false
    const level = (profile.education_level_name || '').toLowerCase()
    const category = (profile.education_level_category || '').toLowerCase()
    if (category.includes('university') || level.includes('university') || level.includes('higher')) return Boolean(profile.program_id)
    if (category.includes('tvet') || level.includes('tvet') || level.includes('sod') || /\bl[345]\b/i.test(profile.grade_name || level)) return Boolean(profile.grade_id && profile.program_id)
    return Boolean(profile.grade_id)
}
function educationCategory(profile: EducationProfile | null): 'primary' | 'secondary' | 'tvet' | 'university' {
    const level = (profile?.education_level_name || '').toLowerCase()
    const category = (profile?.education_level_category || '').toLowerCase()
    if (category.includes('tvet') || level.includes('tvet') || /^l[345]$/i.test(profile?.grade_name || '')) return 'tvet'
    if (category.includes('university') || level.includes('university') || level.includes('higher')) return 'university'
    return category.includes('primary') || level.includes('primary') ? 'primary' : 'secondary'
}
const courses: Course[] = []
const subjects = ['All subjects']
const educationLevels = ['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6', 'Secondary 1', 'Secondary 2', 'Secondary 3', 'Secondary 4', 'Secondary 5', 'Secondary 6', 'L3', 'L4', 'L5', 'Computer Science', 'Software Engineering', 'Information Technology', 'Networking', 'Cybersecurity', 'Artificial Intelligence', 'Data Science', 'Business', 'Economics', 'Accounting', 'Finance', 'Law', 'Education', 'Engineering', 'Medicine', 'Nursing', 'Agriculture', 'Architecture', 'Mathematics', 'Physics', 'Chemistry', 'Biology']
const lessons = [{ title: 'Welcome to algebra', duration: '08 min', type: 'Video', completed: true }, { title: 'Variables and expressions', duration: '18 min', type: 'Lesson', completed: true }, { title: 'Solving one-step equations', duration: '22 min', type: 'Lesson', completed: false }, { title: 'Practice: equations', duration: '10 min', type: 'Quiz', completed: false }]
const quizQuestions: Question[] = [
    { id: 1, type: 'multiple-choice', prompt: 'Which operation isolates x in x + 4 = 11?', options: ['Add 4', 'Subtract 4', 'Multiply by 4', 'Divide by 4'], answer: 'Subtract 4', explanation: 'Subtracting 4 from both sides cancels the +4 and keeps the equation balanced.' },
    { id: 2, type: 'true-false', prompt: 'Whatever you do to one side of an equation, you must also do to the other side.', options: ['True', 'False'], answer: 'True', explanation: 'The balance principle means both sides must receive the same operation.' },
    { id: 3, type: 'fill-blank', prompt: 'Complete the equation: 3x = 18, so x = ___.', answer: '6', explanation: 'Divide both sides by 3: 18 divided by 3 equals 6.' },
    { id: 4, type: 'matching', prompt: 'Which inverse operation undoes multiplication?', options: ['Addition', 'Subtraction', 'Multiplication', 'Division'], answer: 'Division', explanation: 'Division is the inverse of multiplication.' },
    { id: 5, type: 'short-answer', prompt: 'In one sentence, explain why x = 7 solves x + 4 = 11.', answer: '7', explanation: 'Substituting 7 gives 7 + 4 = 11, which is true.' },
    { id: 6, type: 'programming', prompt: 'Write the value that this expression returns: solve(2, 10) where solve(a, b) returns b / a.', answer: '5', explanation: 'The function returns 10 divided by 2, which is 5.' },
]
const initialTeacherCourses: TeacherCourse[] = [{ id: 1, title: 'Algebra foundations', subject: 'Mathematics', students: 128, lessons: 18, published: true, progress: 68, color: 'coral' }, { id: 2, title: 'Exam prep: equations', subject: 'Mathematics', students: 64, lessons: 8, published: false, progress: 0, color: 'sky' }]

function App() {
    const [view, setView] = useState<View>(() => {
        const storedRole = getStoredUser()?.role
        return storedRole === 'teacher' ? 'teacher' : 'dashboard'
    })
    const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('edusphere-auth') === 'true' && Boolean(getAccessToken()))
    const [currentUser, setCurrentUser] = useState<ApiSession['user'] | null>(() => getStoredUser())
    const [availableCourses, setAvailableCourses] = useState<Course[]>(courses)
    const [educationProfile, setEducationProfile] = useState<EducationProfile | null>(null)
    const [learningDashboard, setLearningDashboard] = useState<LearningDashboard | null>(null)
    const [learningDashboardLoading, setLearningDashboardLoading] = useState(false)
    const [learningDashboardError, setLearningDashboardError] = useState('')
    const [tvetDashboard, setTvetDashboard] = useState<TvetDashboardData | null>(null)
    const [universityDashboard, setUniversityDashboard] = useState<UniversityDashboardData | null>(null)
    const [learningSummary, setLearningSummary] = useState<LearningSummary | null>(null)
    const [activeCourse, setActiveCourse] = useState<Course | null>(null)
    const [activeLessonId, setActiveLessonId] = useState<string | undefined>(() => sessionStorage.getItem('edusphere-active-lesson') || undefined)
    const [query, setQuery] = useState('')
    const [darkMode, setDarkMode] = useState(() => localStorage.getItem('edusphere-theme') === 'dark')
    const [mobileMenu, setMobileMenu] = useState(false)
    const [notifications, setNotifications] = useState(false)
    const [profileMenu, setProfileMenu] = useState(false)
    const [assessmentMode, setAssessmentMode] = useState<AssessmentMode>('practice')
    const [assessmentResult, setAssessmentResult] = useState<AssessmentResult | null>(() => { const saved = localStorage.getItem('edusphere-last-result'); return saved ? JSON.parse(saved) as AssessmentResult : null })
    const [teacherTab, setTeacherTab] = useState('Overview')
    const [isBooting, setIsBooting] = useState(true)
    const [showEducationOnboarding, setShowEducationOnboarding] = useState(false)
    const [educationProfileLoading, setEducationProfileLoading] = useState(() => localStorage.getItem('edusphere-auth') === 'true' && Boolean(getAccessToken()) && getStoredUser()?.role === 'student')
    const [educationProfileError, setEducationProfileError] = useState('')
    const [educationProfileLoadAttempt, setEducationProfileLoadAttempt] = useState(0)
    const [teacherLogin, setTeacherLogin] = useState(false)

    function clearSessionData() {
        setAvailableCourses([])
        setEducationProfile(null)
        setLearningDashboard(null)
        setLearningDashboardLoading(false)
        setLearningDashboardError('')
        setTvetDashboard(null)
        setUniversityDashboard(null)
        setLearningSummary(null)
        setActiveCourse(null)
        setActiveLessonId(undefined)
        setAssessmentResult(null)
        sessionStorage.removeItem('edusphere-active-lesson')
        localStorage.removeItem('edusphere-last-result')
    }

    function acceptSession(session: ApiSession) {
        clearSessionData()
        setEducationProfileLoading(session.user.role === 'student')
        setEducationProfileError('')
        setShowEducationOnboarding(false)
        setCurrentUser(session.user)
        setView(session.user.role === 'teacher' ? 'teacher' : 'dashboard')
        setIsAuthenticated(true)
    }

    const currentRole = currentUser?.role
    const dashboardCategory = educationCategory(educationProfile)
    const profileProgramId = educationProfile?.program_id
    const profileGradeId = educationProfile?.grade_id
    useEffect(() => {
        if (!isAuthenticated || !currentRole || !canAccessAdmin(currentRole)) return
        if (window.location.pathname !== '/Admin%20Dashboard.html') {
            window.location.replace('/Admin%20Dashboard.html')
        }
    }, [isAuthenticated, currentRole])

    useEffect(() => { document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'; localStorage.setItem('edusphere-theme', darkMode ? 'dark' : 'light') }, [darkMode])
    useEffect(() => { if (isAuthenticated) localStorage.setItem('edusphere-auth', 'true'); else localStorage.removeItem('edusphere-auth') }, [isAuthenticated])
    useEffect(() => {
        if (!isAuthenticated || currentUser?.role !== 'student') return
        let cancelled = false
        api.educationProfile().then((result) => {
            if (cancelled) return
            setEducationProfile(result.data)
            setShowEducationOnboarding(!hasCompleteEducationProfile(result.data))
        }).catch((error: unknown) => {
            if (cancelled) return
            setEducationProfile(null)
            setEducationProfileError(error instanceof Error ? error.message : 'Your class could not be loaded.')
        }).finally(() => {
            if (!cancelled) setEducationProfileLoading(false)
        })
        return () => { cancelled = true }
    }, [isAuthenticated, currentUser?.id, currentUser?.role, educationProfileLoadAttempt])
    useEffect(() => {
        if (!isAuthenticated || currentUser?.role !== 'student') return
        api.learningSummary().then((result) => setLearningSummary(result.data)).catch(() => setLearningSummary(null))
    }, [isAuthenticated, currentUser?.id, currentUser?.role])
    useEffect(() => {
        if (!isAuthenticated || currentUser?.role !== 'student') return
        if (!educationProfile?.education_level_id) return
        let cancelled = false
        setLearningDashboardLoading(true)
        setLearningDashboardError('')
        api.learningDashboard().then((result) => {
            if (cancelled) return
            setLearningDashboard(result.data)
            setLearningDashboardError('')
            setEducationProfile(result.data.profile)
            const completedByCourse = new Map<string, number>()
            for (const item of result.data.progress as Array<{ course_id: string; completed_at: string | null }>) {
                if (item.completed_at) completedByCourse.set(item.course_id, (completedByCourse.get(item.course_id) || 0) + 1)
            }
            setAvailableCourses(result.data.courses.map((course: ApiCourse, index) => ({ id: course.id, title: course.title, category: course.subject, teacher: course.teacher || '', lessons: course.lessons || 0, progress: course.lessons ? Math.round((completedByCourse.get(course.id) || 0) / course.lessons * 100) : 0, difficulty: course.difficulty, color: ['coral', 'sky', 'ink', 'violet'][index % 4], icon: '•', description: course.description })))
        }).catch((error: unknown) => {
            if (cancelled) return
            setLearningDashboard(null)
            setAvailableCourses([])
            setLearningDashboardError(error instanceof Error ? error.message : 'Learning materials could not be loaded.')
        }).finally(() => {
            if (!cancelled) setLearningDashboardLoading(false)
        })
        return () => { cancelled = true }
    }, [isAuthenticated, currentUser?.id, currentUser?.role, educationProfile?.education_level_id, educationProfile?.grade_id, educationProfile?.program_id])
    useEffect(() => {
        if (!isAuthenticated || currentUser?.role !== 'student' || view !== 'learning') return
        let cancelled = false
        const refreshMaterials = async () => {
            try {
                const result = await api.learningDashboard()
                if (!cancelled) {
                    setLearningDashboard(result.data)
                    setLearningDashboardError('')
                }
            } catch (error) {
                if (!cancelled) setLearningDashboardError(error instanceof Error ? error.message : 'Learning materials could not be refreshed.')
            }
        }
        void refreshMaterials()
        const timer = window.setInterval(() => { void refreshMaterials() }, 15_000)
        return () => { cancelled = true; window.clearInterval(timer) }
    }, [isAuthenticated, currentUser?.id, currentUser?.role, view])
    useEffect(() => {
        if (!isAuthenticated || currentUser?.role !== 'student' || dashboardCategory !== 'tvet' || !profileProgramId || !profileGradeId) return
        api.tvetDashboard().then((result) => setTvetDashboard(result.data)).catch(() => setTvetDashboard(null))
    }, [isAuthenticated, currentUser?.id, currentUser?.role, dashboardCategory, profileGradeId, profileProgramId])
    useEffect(() => {
        if (!isAuthenticated || currentUser?.role !== 'student' || dashboardCategory !== 'university' || !profileProgramId) return
        api.universityDashboard().then((result) => setUniversityDashboard(result.data)).catch(() => setUniversityDashboard(null))
    }, [isAuthenticated, currentUser?.id, currentUser?.role, dashboardCategory, profileProgramId])
    useEffect(() => { const timer = window.setTimeout(() => setIsBooting(false), 280); return () => window.clearTimeout(timer) }, [])

    async function logout() { try { await api.logout() } finally { clearSessionData(); setCurrentUser(null); setIsAuthenticated(false); setShowEducationOnboarding(false); setView('dashboard') } }
    async function refreshLearningDashboard() {
        setLearningDashboardLoading(true)
        setLearningDashboardError('')
        try {
            const result = await api.learningDashboard()
            setLearningDashboard(result.data)
            setLearningDashboardError('')
        } catch (error) {
            setLearningDashboardError(error instanceof Error ? error.message : 'Learning materials could not be refreshed.')
        } finally {
            setLearningDashboardLoading(false)
        }
    }
    async function changeLearningPath() {
        window.alert('Your school assigns your class and program. Contact your school administrator to request a correction or transfer.')
    }
    async function completeEducationOnboarding() {
        const result = await api.educationProfile()
        setEducationProfile(result.data)
        setShowEducationOnboarding(!hasCompleteEducationProfile(result.data))
    }

    if (!isAuthenticated) return teacherLogin ? <TeacherLoginScreen onBack={() => setTeacherLogin(false)} onSuccess={(session) => { acceptSession(session); setTeacherLogin(false) }} /> : <HtmlLoginScreen onTeacherLogin={() => setTeacherLogin(true)} onSuccess={acceptSession} />
    if (isBooting) return <LoadingScreen />
    if (currentRole && canAccessAdmin(currentRole) && window.location.pathname !== '/Admin%20Dashboard.html') return <LoadingScreen />
    if (currentUser?.role === 'student' && educationProfileLoading) return <LoadingScreen />
    if (currentUser?.role === 'student' && educationProfileError) return <main className="education-onboarding"><div className="education-onboarding-glow" /><section className="education-onboarding-content"><div className="education-intro"><h1>Your class could not be loaded.</h1><p role="alert">{educationProfileError}</p><button className="education-continue" onClick={() => { setEducationProfileError(''); setEducationProfileLoading(true); setEducationProfileLoadAttempt((attempt) => attempt + 1) }}>Try again</button></div></section></main>
    if (showEducationOnboarding) return <EducationOnboarding initialProfile={educationProfile} onComplete={completeEducationOnboarding} />

    const dashboardCourses: Course[] = dashboardCategory === 'university' && universityDashboard?.courses.length
        ? universityDashboard.courses.map((course, index) => ({
            id: course.id,
            title: course.title,
            category: course.subject,
            teacher: course.teacher || '',
            lessons: course.lessons || 0,
            progress: learningSummary?.courses.find((item) => item.id === course.id)?.progress || 0,
            difficulty: course.difficulty || 'Course',
            color: ['coral', 'sky', 'ink', 'violet'][index % 4],
            icon: '•',
            description: course.description,
        }))
        : availableCourses
    const filteredCourses = dashboardCourses.filter((course) => `${course.title} ${course.category} ${course.teacher}`.toLowerCase().includes(query.toLowerCase()))
    const openCourse = (course: Course) => { setActiveCourse(course); setView('course'); setMobileMenu(false) }
    const openLesson = (lessonId?: string) => { const nextLessonId = lessonId || sessionStorage.getItem('edusphere-active-lesson') || undefined; setActiveLessonId(nextLessonId); setView('lesson'); setMobileMenu(false) }
    const openAssessment = (mode: AssessmentMode) => { setAssessmentMode(mode); setView('assessment'); setMobileMenu(false) }
    const saveAssessmentResult = (result: AssessmentResult) => { setAssessmentResult(result); localStorage.setItem('edusphere-last-result', JSON.stringify(result)); setView('results') }
    const nav = (nextView: View) => { setView(nextView); setMobileMenu(false); setProfileMenu(false) }
    const openLearning = () => {
        setProfileMenu(false)
        if (currentUser?.role === 'teacher') {
            setView('teacher')
            setTeacherTab('My Courses')
            setMobileMenu(false)
        }
        else nav('learning')
    }
    const openHome = () => {
        setProfileMenu(false)
        if (currentUser?.role === 'teacher') {
            setView('teacher')
            setTeacherTab('Overview')
            setMobileMenu(false)
        } else nav('dashboard')
    }
    const overviewCategory = dashboardCategory === 'primary' ? 'primary' : 'secondary'
    const homeIsActive = currentUser?.role === 'teacher' ? view === 'teacher' && teacherTab === 'Overview' : view === 'dashboard'
    return <div className="app-shell">
        <aside className={`sidebar ${mobileMenu ? 'is-open' : ''}`}>
            <div className="brand"><span className="brand-mark"><Sparkles size={18} /></span><span>Edu<span>Sphere</span></span></div>
            <button className="mobile-close icon-button" aria-label="Close menu" onClick={() => setMobileMenu(false)}><X size={20} /></button>
            <div className="profile-card">
                <div className="avatar">{(currentUser?.fullName || 'S').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div>
                <div><strong>{currentUser?.fullName || 'Student'}</strong><span>{currentUser?.role === 'teacher' ? 'Teacher account' : 'Student account'}</span></div>
                <button className="more-button" aria-label="Profile options" aria-expanded={profileMenu} onClick={() => setProfileMenu((open) => !open)}><MoreHorizontal size={17} /></button>
            </div>
            <nav className="main-nav" aria-label="Main navigation">
                <p className="nav-label">Workspace</p>
                <NavButton icon={<LayoutDashboard size={18} />} label={currentUser?.role === 'teacher' ? 'Teacher home' : 'Overview'} active={currentUser?.role === 'teacher' ? view === 'teacher' && teacherTab === 'Overview' : view === 'dashboard'} onClick={openHome} />
                <NavButton icon={<BookOpen size={18} />} label="My learning" active={currentUser?.role === 'teacher' ? view === 'teacher' && teacherTab === 'My Courses' : view === 'learning' || view === 'course' || view === 'lesson'} count={String(currentUser?.role === 'student' ? learningDashboard?.materials.length || 0 : dashboardCourses.length)} onClick={openLearning} />
                <NavButton icon={<CalendarDays size={18} />} label="Calendar" active={view === 'calendar'} onClick={() => nav('calendar')} />
                <NavButton icon={<Trophy size={18} />} label="Achievements" active={view === 'achievements'} onClick={() => nav('achievements')} />
            </nav>
            <div className="sidebar-bottom">
                <button onClick={() => setDarkMode((dark) => !dark)}>{darkMode ? <Sun size={18} /> : <Moon size={18} />}{darkMode ? 'Light mode' : 'Dark mode'}</button>
                <button onClick={() => void logout()}><LogIn size={18} />Sign out</button>
                <div className="help-card"><div className="help-icon"><Sparkles size={17} /></div><strong>Need a little help?</strong><span>Explore our learning guide.</span><button className="help-link" onClick={openLearning}>View learning <ArrowRight size={14} /></button></div>
                <div className="sidebar-footer"><span>EduSphere v1.0</span></div>
            </div>
        </aside>
        <main className="main-content">
            <header className="topbar">
                <button className="mobile-menu icon-button" aria-label="Open menu" onClick={() => setMobileMenu(true)}><Menu size={22} /></button>
                <div className="breadcrumb"><span>{currentUser?.role === 'teacher' ? 'Teacher workspace' : 'Workspace'}</span><ChevronRight size={14} /><strong>{view === 'dashboard' ? 'Overview' : view === 'learning' ? 'My learning' : view === 'calendar' ? 'Calendar' : view === 'achievements' ? 'Achievements' : view === 'course' ? activeCourse?.title || 'My learning' : view === 'teacher' ? teacherTab : view === 'assessment' ? 'Assessment' : view === 'results' ? 'Results' : 'Lesson'}</strong></div>
                <div className="top-actions">
                    <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search courses..." aria-label="Search courses" onFocus={openLearning} /><kbd>⌘ K</kbd></label>
                    <button className="icon-button" aria-label="Toggle dark mode" onClick={() => setDarkMode(!darkMode)}>{darkMode ? <Sun size={19} /> : <Moon size={19} />}</button>
                    <button className="icon-button notification-button" aria-label="Show notifications" onClick={() => setNotifications(!notifications)}><Bell size={19} /><i /></button>
                    <div className="profile-menu-wrap">
                        <button className="small-avatar" aria-label="Open user menu" aria-expanded={profileMenu} onClick={() => setProfileMenu((open) => !open)}>{(currentUser?.fullName || 'S').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}<MoreHorizontal size={14} /></button>
                        {profileMenu && <div className="profile-menu" role="menu">
                            <strong>{currentUser?.fullName || 'Student'}</strong><small>{currentUser?.email}</small>
                            <button role="menuitem" onClick={openLearning}><BookOpen size={15} />My learning</button>
                            <button role="menuitem" onClick={() => nav('calendar')}><CalendarDays size={15} />Calendar</button>
                            <button role="menuitem" onClick={() => nav('achievements')}><Trophy size={15} />Achievements</button>
                            <button role="menuitem" onClick={() => { setDarkMode((dark) => !dark); setProfileMenu(false) }}>{darkMode ? <Sun size={15} /> : <Moon size={15} />}{darkMode ? 'Light mode' : 'Dark mode'}</button>
                            <button role="menuitem" onClick={() => void logout()}><LogIn size={15} />Sign out</button>
                        </div>}
                    </div>
                </div>
                {notifications && <div className="notification-popover"><strong>Notifications</strong><p>{view === 'teacher' ? 'Review your latest submissions.' : 'Check your published learning activity.'}</p></div>}
            </header>
            {view === 'dashboard' && (dashboardCategory === 'tvet' ? <TvetDashboard data={tvetDashboard} loading={!tvetDashboard} courses={dashboardCourses} onOpenCourse={openCourse} onViewAllCourses={openLearning} onChangeLearningPath={changeLearningPath} /> : dashboardCategory === 'university' ? <UniversityDashboard data={universityDashboard} loading={!universityDashboard} courses={dashboardCourses} onOpenCourse={openCourse} onViewAllCourses={openLearning} onChangeLearningPath={changeLearningPath} /> : <StudentDashboard mode="overview" category={overviewCategory} userName={currentUser?.fullName || 'Student'} courses={dashboardCourses} subjects={learningDashboard?.subjects || []} learningDashboard={learningDashboard} summary={learningSummary} profile={educationProfile} onOpenCourse={openCourse} onViewAllCourses={openLearning} onChangeLearningPath={changeLearningPath} />)}
            {view === 'learning' && currentUser?.role === 'student' && <StudentDashboard mode="learning" category={overviewCategory} userName={currentUser.fullName} courses={filteredCourses} subjects={learningDashboard?.subjects || []} learningDashboard={learningDashboard} learningDashboardLoading={learningDashboardLoading} learningDashboardError={learningDashboardError} onRefreshLearningDashboard={() => void refreshLearningDashboard()} summary={learningSummary} profile={educationProfile} onOpenCourse={openCourse} onViewAllCourses={openLearning} onChangeLearningPath={changeLearningPath} />}
            {view === 'calendar' && <CalendarPage homework={learningSummary?.homework || []} />}
            {view === 'achievements' && <AchievementsPage summary={learningSummary} />}
            {view === 'course' && activeCourse && <LearningPath courseId={activeCourse.id} fallbackTitle={activeCourse.title} fallbackCategory={activeCourse.category} fallbackDescription={activeCourse.description} fallbackTeacher={activeCourse.teacher} color={activeCourse.color} icon={activeCourse.icon} onBack={openLearning} onLesson={openLesson} />}
            {view === 'lesson' && activeCourse && <LessonWorkspace courseId={activeCourse.id} lessonId={activeLessonId} courseTitle={activeCourse.title} onBack={() => nav('course')} onAssessment={openAssessment} />}
            {view === 'assessment' && <AssessmentPage mode={assessmentMode} onBack={() => nav('course')} onSubmit={saveAssessmentResult} />}
            {view === 'results' && assessmentResult && <ResultsPage userName={currentUser?.fullName || 'Student'} result={assessmentResult} onRetry={() => openAssessment(assessmentResult.mode)} onBack={() => nav('course')} />}
            {view === 'teacher' && currentUser?.role === 'teacher' && <TeacherWorkspace />}
        </main>
        <nav className="mobile-nav" aria-label="Mobile navigation">
            <button className={homeIsActive ? 'active' : ''} onClick={openHome}><LayoutDashboard size={19} /><span>Home</span></button>
            <button className={view === 'learning' || view === 'course' || view === 'lesson' ? 'active' : ''} onClick={openLearning}><BookOpen size={19} /><span>My learning</span></button>
            <button className={view === 'calendar' ? 'active' : ''} onClick={() => nav('calendar')}><CalendarDays size={19} /><span>Calendar</span></button>
            <button className={view === 'achievements' ? 'active' : ''} onClick={() => nav('achievements')}><Trophy size={19} /><span>Awards</span></button>
        </nav>
        <StudentAiTutor />
    </div>
}

function CalendarPage({ homework }: { homework: LearningSummary['homework'] }) {
    const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
    const offset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7
    const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    const cells = [...Array(offset).fill(null), ...Array.from({ length: dayCount }, (_, index) => index + 1)]
    const events = homework.flatMap((item) => {
        const dueDate = new Date(item.due_at)
        if (Number.isNaN(dueDate.getTime())) return []
        return [{ ...item, day: dueDate.getDate(), month: dueDate.getMonth(), year: dueDate.getFullYear() }]
    })
    const today = new Date()
    const assignmentsThisMonth = events.filter((event) => event.month === month.getMonth() && event.year === month.getFullYear())
        .sort((a, b) => a.day - b.day)

    return <div className="workspace-page calendar-page">
        <header className="workspace-page-heading">
            <div><span className="workspace-page-kicker"><CalendarDays size={15} /> Stay on track</span><h1>Calendar</h1><p>Keep an eye on homework due dates and your study schedule.</p></div>
            <div className="calendar-month-controls">
                <button aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={18} /></button>
                <strong>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
                <button aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={18} /></button>
            </div>
        </header>
        <section className="calendar-panel">
            <div className="calendar-grid calendar-weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="calendar-grid calendar-days">
                {cells.map((day, index) => {
                    if (day === null) return <div className="calendar-day empty" key={`empty-${index}`} />
                    const dueItems = events.filter((event) => event.day === day && event.month === month.getMonth() && event.year === month.getFullYear())
                    const isToday = today.getFullYear() === month.getFullYear() && today.getMonth() === month.getMonth() && today.getDate() === day
                    return <div className={`calendar-day ${isToday ? 'today' : ''}`} key={day}>
                        <span className="calendar-date">{day}</span>
                        {dueItems.slice(0, 2).map((item) => <span className="calendar-event" key={item.id} title={item.title}>{item.title}</span>)}
                        {dueItems.length > 2 && <small>+{dueItems.length - 2} more</small>}
                    </div>
                })}
            </div>
        </section>
        <section className="calendar-agenda">
            <div className="workspace-section-heading"><div><span>Your schedule</span><h2>Due this month</h2></div><span>{assignmentsThisMonth.length} {assignmentsThisMonth.length === 1 ? 'assignment' : 'assignments'}</span></div>
            {assignmentsThisMonth.length ? assignmentsThisMonth.map((item) => <article className="calendar-agenda-item" key={item.id}>
                <span className="calendar-agenda-date">{new Date(item.due_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                <div><strong>{item.title}</strong><small>{item.status}</small></div>
            </article>) : <div className="workspace-empty"><CalendarDays size={22} /><strong>No homework due this month</strong><span>New assignments from your class will appear here.</span></div>}
        </section>
    </div>
}

function AchievementsPage({ summary }: { summary: LearningSummary | null }) {
    const achievements = summary?.achievements || []
    const stats = [
        { label: 'Lessons completed', value: summary?.lessonsCompleted || 0, Icon: BookOpen },
        { label: 'Courses completed', value: summary?.coursesCompleted || 0, Icon: CheckCircle2 },
        { label: 'Learning streak', value: `${summary?.learningStreak || 0} days`, Icon: Flame },
    ]

    return <div className="workspace-page achievements-page">
        <header className="workspace-page-heading">
            <div><span className="workspace-page-kicker"><Trophy size={15} /> Every step counts</span><h1>Achievements</h1><p>Celebrate your effort and the progress you have made.</p></div>
        </header>
        <section className="achievement-stats">
            {stats.map(({ label, value, Icon }) => <article className="achievement-stat-card" key={label}><span><Icon size={20} /></span><div><strong>{value}</strong><small>{label}</small></div></article>)}
        </section>
        <section className="achievement-list-panel">
            <div className="workspace-section-heading"><div><span>Your milestones</span><h2>Earned achievements</h2></div><span>{achievements.length} earned</span></div>
            {achievements.length ? <div className="achievement-list">{achievements.map((achievement) => <article className="achievement-item" key={achievement.key}>
                <span className="achievement-item-icon"><Award size={21} /></span>
                <div><strong>{achievement.name}</strong><p>{achievement.description}</p></div>
                <time dateTime={achievement.earned_at}>{new Date(achievement.earned_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</time>
            </article>)}</div> : <div className="workspace-empty"><Award size={24} /><strong>Your next achievement is waiting</strong><span>Complete lessons and courses to unlock your first milestone.</span></div>}
        </section>
    </div>
}

function TeacherPortal({ tab, setTab }: { tab: string; setTab: (tab: string) => void }) {
    const [teacherCourses, setTeacherCourses] = useState<TeacherCourse[]>(() => { const saved = localStorage.getItem('edusphere-teacher-courses'); return saved ? JSON.parse(saved) as TeacherCourse[] : initialTeacherCourses })
    const [courseTitle, setCourseTitle] = useState('')
    const [courseSubject, setCourseSubject] = useState('Mathematics')
    const [lessonTitle, setLessonTitle] = useState('Solving one-step equations')
    const [lessonBody, setLessonBody] = useState('An equation is a balanced statement. Use inverse operations to isolate the unknown.')
    const [quizQuestion, setQuizQuestion] = useState('Which operation isolates x in x + 4 = 11?')
    const [quizAnswer, setQuizAnswer] = useState('Subtract 4')
    const [assignmentTitle, setAssignmentTitle] = useState('Equation practice set')
    const [savedNotice, setSavedNotice] = useState('')
    useEffect(() => { localStorage.setItem('edusphere-teacher-courses', JSON.stringify(teacherCourses)) }, [teacherCourses])
    function notify(message: string) { setSavedNotice(message); window.setTimeout(() => setSavedNotice(''), 2200) }
    function createCourse(event: FormEvent) { event.preventDefault(); if (!courseTitle.trim()) return; setTeacherCourses((items) => [...items, { id: Date.now(), title: courseTitle, subject: courseSubject, students: 0, lessons: 0, published: false, progress: 0, color: 'violet' }]); setCourseTitle(''); notify('Course draft created') }
    const tabs = [['Overview', <LayoutDashboard size={16} />], ['Courses', <BookOpen size={16} />], ['Lesson editor', <Edit3 size={16} />], ['Quiz builder', <ListChecks size={16} />], ['Assignments', <FileText size={16} />], ['Edusphere AI', <Sparkles size={16} />], ['Analytics', <BarChart3 size={16} />]] as const
    return <div className="teacher-page"><div className="teacher-heading"><div><p className="eyebrow">Teacher workspace</p><h1>Good morning, Maya.</h1><p>Here is what is happening across your learning community.</p></div><button className="primary-button" onClick={() => setTab('Courses')}><Plus size={16} /> Create course</button></div><div className="teacher-tabs">{tabs.map(([label, icon]) => <button key={label} className={tab === label ? 'active' : ''} onClick={() => setTab(label)}>{icon}{label}</button>)}</div>{savedNotice && <div className="saved-notice"><CheckCircle2 size={15} /> {savedNotice}</div>}{tab === 'Overview' && <TeacherOverview teacherCourses={teacherCourses} setTab={setTab} />}{tab === 'Courses' && <TeacherCourses teacherCourses={teacherCourses} setTeacherCourses={setTeacherCourses} courseTitle={courseTitle} setCourseTitle={setCourseTitle} courseSubject={courseSubject} setCourseSubject={setCourseSubject} createCourse={createCourse} notify={notify} />}{tab === 'Lesson editor' && <LessonEditor lessonTitle={lessonTitle} setLessonTitle={setLessonTitle} lessonBody={lessonBody} setLessonBody={setLessonBody} notify={notify} />}{tab === 'Quiz builder' && <QuizBuilder quizQuestion={quizQuestion} setQuizQuestion={setQuizQuestion} quizAnswer={quizAnswer} setQuizAnswer={setQuizAnswer} notify={notify} />}{tab === 'Assignments' && <AssignmentManager assignmentTitle={assignmentTitle} setAssignmentTitle={setAssignmentTitle} notify={notify} />}{tab === 'Edusphere AI' && <TeacherAiTools notify={notify} />}{tab === 'Analytics' && <TeacherAnalytics />}</div>
}

function TeacherOverview({ teacherCourses, setTab }: { teacherCourses: TeacherCourse[]; setTab: (tab: string) => void }) { return <><section className="teacher-stats"><Stat icon={<BookOpen size={18} />} label="Published courses" value={String(teacherCourses.filter((course) => course.published).length)} detail="2 drafts in progress" tone="blue" /><Stat icon={<Users size={18} />} label="Active students" value="192" detail="+18 this month" tone="green" /><Stat icon={<CheckCircle2 size={18} />} label="Avg. completion" value="74%" detail="+6% this term" tone="orange" /><Stat icon={<Clock3 size={18} />} label="Reviews pending" value="12" detail="Due this week" tone="pink" /></section><div className="teacher-grid"><section className="teacher-panel"><div className="section-heading compact"><div><p className="eyebrow">Your teaching catalog</p><h2>Courses</h2></div><button className="text-button" onClick={() => setTab('Courses')}>Manage <ArrowRight size={14} /></button></div>{teacherCourses.map((course) => <div className="teacher-course-row" key={course.id}><div className={`teacher-course-dot ${course.color}`} /><div><strong>{course.title}</strong><span>{course.subject} · {course.students} students · {course.lessons} lessons</span></div><span className={`status-pill ${course.published ? 'published' : 'draft'}`}>{course.published ? 'Published' : 'Draft'}</span></div>)}</section><section className="teacher-panel"><div className="section-heading compact"><div><p className="eyebrow">Recent activity</p><h2>Needs your attention</h2></div><MoreHorizontal size={17} /></div><div className="teacher-activity"><span className="activity-avatar blue-bg"><FileText size={14} /></span><div><strong>12 submissions received</strong><span>Equation practice · 2 hours ago</span></div></div><div className="teacher-activity"><span className="activity-avatar orange-bg"><ListChecks size={14} /></span><div><strong>Quiz average reached 86%</strong><span>Algebra foundations · Yesterday</span></div></div><div className="teacher-activity"><span className="activity-avatar green-bg"><Award size={14} /></span><div><strong>8 students earned a badge</strong><span>Physics essentials · Monday</span></div></div></section></div><section className="teacher-panel performance-panel"><div className="section-heading compact"><div><p className="eyebrow">Student learning</p><h2>Performance overview</h2></div><select defaultValue="30"><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></div><div className="performance-chart">{[44, 60, 48, 76, 63, 88, 72, 94, 78, 86, 91, 82].map((height, index) => <div className="performance-bar" key={index}><span style={{ height: `${height}%` }} /><small>{index + 1}</small></div>)}</div><div className="chart-summary"><span><i className="blue-dot" />Average score <strong>86%</strong></span><span><i className="green-dot-solid" />Completion <strong>74%</strong></span><span><i className="orange-dot-solid" />Study time <strong>312h</strong></span></div></section></> }

function TeacherCourses({ teacherCourses, setTeacherCourses, courseTitle, setCourseTitle, courseSubject, setCourseSubject, createCourse, notify }: { teacherCourses: TeacherCourse[]; setTeacherCourses: Dispatch<SetStateAction<TeacherCourse[]>>; courseTitle: string; setCourseTitle: (value: string) => void; courseSubject: string; setCourseSubject: (value: string) => void; createCourse: (event: FormEvent) => void; notify: (message: string) => void }) { return <div className="teacher-management"><section className="teacher-panel create-course-panel"><div><p className="eyebrow">Course management</p><h2>Create a new course</h2><p>Start with the basics. You can add lessons, media, quizzes, and assessments next.</p></div><form onSubmit={createCourse}><input required value={courseTitle} onChange={(event) => setCourseTitle(event.target.value)} placeholder="Course title" /><select value={courseSubject} onChange={(event) => setCourseSubject(event.target.value)}><option>Mathematics</option><option>Physics</option><option>Biology</option><option>Software Development</option><option>Languages</option></select><button className="primary-button" type="submit"><Plus size={15} /> Create draft</button></form></section><section className="teacher-panel"><div className="section-heading compact"><div><p className="eyebrow">Content library</p><h2>Your courses</h2></div><span className="muted-count">{teacherCourses.length} courses</span></div><div className="management-table"><div className="table-head"><span>Course</span><span>Students</span><span>Lessons</span><span>Status</span><span>Actions</span></div>{teacherCourses.map((course) => <div className="table-row" key={course.id}><div className="table-course"><span className={`teacher-course-dot ${course.color}`} /><strong>{course.title}</strong><small>{course.subject}</small></div><span>{course.students}</span><span>{course.lessons}</span><button className={`status-pill ${course.published ? 'published' : 'draft'}`} onClick={() => { setTeacherCourses((items) => items.map((item) => item.id === course.id ? { ...item, published: !item.published } : item)); notify(course.published ? 'Course unpublished' : 'Course published') }}>{course.published ? 'Published' : 'Draft'}</button><div className="table-actions"><button aria-label="Edit course" onClick={() => notify('Course loaded into editor')}><Edit3 size={15} /></button><button aria-label="Preview course"><Eye size={15} /></button><button aria-label="Delete course" onClick={() => { if (window.confirm(`Delete ${course.title}? This cannot be undone.`)) { setTeacherCourses((items) => items.filter((item) => item.id !== course.id)); notify('Course deleted') } }}><Trash2 size={15} /></button></div></div>)}</div></section></div> }

function LessonEditor({ lessonTitle, setLessonTitle, lessonBody, setLessonBody, notify }: { lessonTitle: string; setLessonTitle: (value: string) => void; lessonBody: string; setLessonBody: (value: string) => void; notify: (message: string) => void }) { return <div className="editor-layout"><section className="teacher-panel lesson-editor-panel"><div className="editor-toolbar"><button className="active">H1</button><button>B</button><button>I</button><button><ImageIcon size={15} /></button><button><Video size={15} /></button><button><Code2 size={15} /></button><button><FileText size={15} /></button><span /><button onClick={() => notify('Material attached')}><Upload size={15} /> Attach</button></div><input className="editor-title" value={lessonTitle} onChange={(event) => setLessonTitle(event.target.value)} /><textarea className="editor-body" value={lessonBody} onChange={(event) => setLessonBody(event.target.value)} /><div className="editor-blocks"><button><Plus size={15} /> Add text block</button><button><ImageIcon size={15} /> Add image</button><button><Code2 size={15} /> Add code</button><button><NotebookPen size={15} /> Add formula</button><button><FileText size={15} /> Add table</button></div><div className="editor-footer"><span>Autosaved just now</span><button className="primary-button" onClick={() => notify('Lesson saved')}><Check size={15} /> Save lesson</button></div></section><aside className="teacher-panel editor-sidebar"><p className="eyebrow">Lesson settings</p><h2>Publishing details</h2><label>Module<select defaultValue="Module 1"><option>Module 1 · Foundations</option><option>Module 2 · Practice</option><option>Module 3 · Assessment</option></select></label><label>Estimated duration<input defaultValue="22 minutes" /></label><label>Learning materials<button className="upload-drop" onClick={() => notify('File picker ready')}><Upload size={17} /><strong>Drop files here</strong><span>PDF, PNG, MP4 up to 50MB</span></button></label><button className="publish-button" onClick={() => notify('Lesson published')}><Eye size={15} /> Preview and publish</button></aside></div> }

function QuizBuilder({ quizQuestion, setQuizQuestion, quizAnswer, setQuizAnswer, notify }: { quizQuestion: string; setQuizQuestion: (value: string) => void; quizAnswer: string; setQuizAnswer: (value: string) => void; notify: (message: string) => void }) { return <div className="builder-layout"><section className="teacher-panel quiz-builder"><div className="section-heading compact"><div><p className="eyebrow">Assessment authoring</p><h2>Practice quiz</h2></div><span className="status-pill published">6 questions</span></div><div className="quiz-builder-grid"><div className="question-list"><button className="builder-question active"><span>1</span><div><strong>Multiple choice</strong><small>Which operation isolates x?</small></div><Edit3 size={14} /></button><button className="builder-question"><span>2</span><div><strong>True / False</strong><small>The balance principle...</small></div></button><button className="builder-question"><span>3</span><div><strong>Fill in the blank</strong><small>Complete the equation...</small></div></button><button className="add-question" onClick={() => notify('New question added')}><Plus size={15} /> Add question</button></div><div className="question-editor"><label>Question type<select defaultValue="multiple-choice"><option value="multiple-choice">Multiple choice</option><option>True / False</option><option>Fill in the blank</option><option>Short answer</option><option>Programming</option></select></label><label>Question prompt<textarea value={quizQuestion} onChange={(event) => setQuizQuestion(event.target.value)} /></label><div className="answer-editor"><div className="answer-editor-heading"><label>Answers</label><span>Mark the correct answer</span></div>{['Add 4', 'Subtract 4', 'Multiply by 4', 'Divide by 4'].map((answer) => <label className="answer-line" key={answer}><input type="radio" name="correct-answer" checked={quizAnswer === answer} onChange={() => setQuizAnswer(answer)} /><input value={answer} readOnly /><Check size={15} className={quizAnswer === answer ? 'answer-marked' : ''} /></label>)}</div><label>Explanation<textarea defaultValue="Subtracting 4 from both sides cancels the +4 and keeps the equation balanced." /></label><div className="marks-row"><label>Marks<input type="number" defaultValue="2" min="1" /></label><label>Time limit<select defaultValue="60"><option value="30">30 seconds</option><option value="60">1 minute</option><option value="120">2 minutes</option></select></label></div><button className="primary-button" onClick={() => notify('Quiz question saved')}><Check size={15} /> Save question</button></div></div></section></div> }

function AssignmentManager({ assignmentTitle, setAssignmentTitle, notify }: { assignmentTitle: string; setAssignmentTitle: (value: string) => void; notify: (message: string) => void }) { return <div className="assignment-layout"><section className="teacher-panel assignment-editor"><div className="section-heading compact"><div><p className="eyebrow">Assignment authoring</p><h2>Create assignment</h2></div><span className="status-pill draft">Draft</span></div><label>Title<input value={assignmentTitle} onChange={(event) => setAssignmentTitle(event.target.value)} /></label><label>Instructions<textarea defaultValue="Solve each equation and show the inverse operation you used." /></label><div className="form-row"><label>Due date<input type="date" defaultValue="2026-09-24" /></label><label>Total marks<input type="number" defaultValue="20" /></label></div><button className="upload-drop" onClick={() => notify('Resource attached')}><Upload size={17} /><strong>Attach resources</strong><span>Worksheet.pdf · 2.4 MB</span></button><button className="primary-button" onClick={() => notify('Assignment published')}><Send size={15} /> Publish assignment</button></section><section className="teacher-panel submissions-panel"><div className="section-heading compact"><div><p className="eyebrow">Submissions</p><h2>Review student work</h2></div><span className="status-pill draft">12 pending</span></div>{['Student 014', 'Student 028', 'Student 061'].map((student, index) => <div className="submission-row" key={student}><div className="avatar student-avatar">{String(index + 1).padStart(2, '0')}</div><div><strong>{student}</strong><span>Submitted {index + 1}h ago · {index === 0 ? 'Needs review' : 'Ready'}</span></div><button className="secondary-button" onClick={() => notify(`Reviewing ${student}`)}>{index === 0 ? 'Review' : 'Open'} <ArrowRight size={13} /></button></div>)}</section></div> }

function TeacherAiTools({ notify }: { notify: (message: string) => void }) { const [kind, setKind] = useState('lesson-notes'); const [topic, setTopic] = useState('Quadratic equations'); const [draftId, setDraftId] = useState<string | number | null>(null); const [draft, setDraft] = useState(''); const [title, setTitle] = useState(''); const [busy, setBusy] = useState(false); async function generate(event: FormEvent) { event.preventDefault(); setBusy(true); try { const result = await api.aiGenerate({ kind, topic }); setDraftId(result.data.id); setTitle(result.data.title); setDraft(result.data.content.markdown); notify('Editable AI draft created') } catch (caught) { notify(caught instanceof Error ? caught.message : 'Edusphere AI is temporarily unavailable. Please try again.') } finally { setBusy(false) } } async function save() { if (draftId === null) return; setBusy(true); try { await api.updateAiDraft(draftId, { title, markdown: draft }); notify('Draft saved') } catch (caught) { notify(caught instanceof Error ? caught.message : 'Draft could not be saved') } finally { setBusy(false) } } async function publish() { if (draftId === null) return; setBusy(true); try { await api.publishAiDraft(draftId); notify('Draft published') } catch (caught) { notify(caught instanceof Error ? caught.message : 'Draft could not be published') } finally { setBusy(false) } } return <div className="teacher-management"><section className="teacher-panel create-course-panel"><div><p className="eyebrow"><Sparkles size={14} /> Teacher assistant</p><h2>Generate a teaching draft</h2><p>Review and edit every draft before it reaches your students. Existing content is never overwritten.</p></div><form onSubmit={generate}><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="lesson-notes">Lesson notes</option><option value="exercise">Exercises</option><option value="quiz">Quiz</option><option value="exam">Exam</option><option value="assignment">Assignment</option><option value="answer-key">Answer key</option><option value="lesson-plan">Lesson plan</option><option value="lesson-summary">Lesson summary</option></select><input required value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Topic or learning goal" /><button className="primary-button" disabled={busy} type="submit"><Sparkles size={15} /> {busy ? 'Generating...' : 'Generate draft'}</button></form></section><section className="teacher-panel"><div className="section-heading compact"><div><p className="eyebrow">Private draft workspace</p><h2>Review before publishing</h2></div><span className="status-pill draft">Draft only</span></div><input className="editor-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Draft title" /><textarea className="editor-body" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Your generated content will appear here for editing..." /><div className="editor-footer"><span>AI drafts never overwrite teacher content.</span><div><button className="secondary-button" disabled={busy || draftId === null} onClick={() => void save()}><Check size={15} /> Save</button><button className="primary-button" disabled={busy || draftId === null} onClick={() => void publish()}><Send size={15} /> Publish</button></div></div></section></div> }

function TeacherAnalytics() { return <div className="analytics-layout"><section className="teacher-panel analytics-main"><div className="section-heading compact"><div><p className="eyebrow">Anonymized learning data</p><h2>Student performance</h2></div><select defaultValue="course"><option value="course">All courses</option><option>Algebra foundations</option><option>Physics essentials</option></select></div><div className="analytics-kpis"><div><span>Average score</span><strong>86%</strong><small>+8.4% vs last term</small></div><div><span>Completion rate</span><strong>74%</strong><small>+6.1% vs last term</small></div><div><span>Active this week</span><strong>158</strong><small>82% of enrolled</small></div></div><div className="analytics-graph"><div className="graph-line one" /><div className="graph-line two" /><div className="graph-line three" /><span className="graph-label l1">Week 1</span><span className="graph-label l2">Week 2</span><span className="graph-label l3">Week 3</span><span className="graph-label l4">Week 4</span></div><div className="analytics-legend"><span><i className="blue-dot" />Score</span><span><i className="green-dot-solid" />Completion</span></div></section><aside className="teacher-panel privacy-panel"><LockKeyhole size={19} /><h2>Privacy by design</h2><p>Analytics show aggregate patterns only. Individual student names and private data stay protected.</p><div className="privacy-check"><CheckCircle2 size={15} /> No personally identifiable rankings</div><div className="privacy-check"><CheckCircle2 size={15} /> Minimum group size applied</div></aside></div> }

function NavButton({ icon, label, active, count, onClick }: { icon: ReactNode; label: string; active?: boolean; count?: string; onClick: () => void }) { return <button className={active ? 'active' : ''} onClick={onClick}>{icon}{label}{count && <span className="nav-count">{count}</span>}</button> }
function LoadingScreen() { return <div className="loading-shell" role="status" aria-label="Loading EduSphere"><div className="loading-brand"><span className="brand-mark"><Sparkles size={18} /></span><span>Edu<span>Sphere</span></span></div><div className="loading-content"><div className="skeleton skeleton-label" /><div className="skeleton skeleton-title" /><div className="skeleton skeleton-copy" /><div className="skeleton-grid"><div className="skeleton skeleton-hero" /><div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" /></div></div></div> }
function Stat({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: string }) { return <article className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article> }
function CourseCard({ course, onOpen }: { course: Course; onOpen: () => void }) { return <article className="course-card"><div className={`course-visual ${course.color}`}><span className="course-symbol">{course.icon}</span><span className="course-level">{course.difficulty}</span><button className="card-more" aria-label={`${course.title} options`}><MoreHorizontal size={17} /></button></div><div className="course-info"><div className="course-title-row"><div><span className="course-category">{course.category}</span><h3>{course.title}</h3><p className="course-teacher">with {course.teacher}</p></div><strong>{course.progress}%</strong></div><div className="progress-track"><span style={{ width: `${course.progress}%` }} /></div><div className="course-meta"><span><BookOpen size={14} /> {course.lessons} lessons</span><button className="continue-button" onClick={onOpen}>{course.progress ? 'Continue' : 'Start'} <ArrowRight size={14} /></button></div></div></article> }

function Dashboard({ userName, onExplore, onOpenCourse, query }: { userName: string; onExplore: () => void; onOpenCourse: (course: Course) => void; query: string }) { return <div className="page-container"><section className="welcome-row"><div><p className="eyebrow">Thursday, September 17, 2026</p><h1>Good morning, {userName} <span>👋</span></h1><p className="welcome-copy">Keep the momentum going. You are making great progress.</p></div><button className="primary-button" onClick={onExplore}><Plus size={17} />Add a course</button></section><section className="hero-banner"><div className="hero-copy"><div className="hero-tag"><Flame size={14} /> 5 day learning streak</div><h2>Small steps create<br /><em>big breakthroughs.</em></h2><p>You are on a roll. Complete one lesson today to keep your streak alive.</p><button className="light-button" onClick={() => onOpenCourse(courses[0])}>Continue learning <ArrowRight size={16} /></button></div><div className="hero-art" aria-hidden="true"><div className="sun-disc" /><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="planet planet-one">✦</div><div className="planet planet-two">●</div><div className="star star-one">+</div><div className="star star-two">✦</div></div></section><section className="stats-grid"><Stat icon={<BookOpen size={18} />} label="Courses in progress" value="3" detail="1 completed this week" tone="blue" /><Stat icon={<Clock3 size={18} />} label="Learning time" value="4h 32m" detail="+12% from last week" tone="orange" /><Stat icon={<CheckCircle2 size={18} />} label="Average score" value="86%" detail="You are above average" tone="green" /><Stat icon={<Flame size={18} />} label="Current streak" value="5 days" detail="Best: 12 days" tone="pink" /></section><div className="content-grid"><section className="courses-section"><div className="section-heading"><div><p className="eyebrow">Your learning path</p><h2>Continue learning</h2></div><button className="text-button" onClick={onExplore}>View all <ArrowRight size={15} /></button></div><div className="course-list">{courses.filter((course) => `${course.title} ${course.category}`.toLowerCase().includes(query.toLowerCase())).slice(0, 3).map((course) => <CourseCard key={course.id} course={course} onOpen={() => onOpenCourse(course)} />)}</div></section><aside className="right-column"><SchedulePanel /><ActivityPanel /></aside></div></div> }

function SubjectPage({ courses: visibleCourses, activeSubject, setActiveSubject, onOpenCourse }: { courses: Course[]; activeSubject: string; setActiveSubject: (subject: string) => void; onOpenCourse: (course: Course) => void }) { return <div className="page-container"><section className="page-heading"><div><p className="eyebrow">Explore your potential</p><h1>Find your next subject</h1><p>Learn at your pace with expert-led courses across every stage.</p></div><div className="subject-total"><strong>19</strong><span>subjects available</span></div></section><div className="subject-tabs large-tabs" role="tablist">{subjects.map((subject) => <button key={subject} className={activeSubject === subject ? 'selected' : ''} onClick={() => setActiveSubject(subject)}>{subject}</button>)}</div><div className="subject-grid">{visibleCourses.map((course) => <article className="subject-card" key={course.id}><div className={`subject-art ${course.color}`}><span>{course.icon}</span><small>{course.difficulty}</small></div><div className="subject-card-body"><span className="course-category">{course.category}</span><h2>{course.title}</h2><p>{course.description}</p><div className="subject-details"><span><Users size={14} /> {course.teacher}</span><span><BookOpen size={14} /> {course.lessons} lessons</span></div><div className="subject-footer"><span>Progress <strong>{course.progress}%</strong></span><button className="primary-button" onClick={() => onOpenCourse(course)}>{course.progress ? 'Continue' : 'Start course'} <ArrowRight size={14} /></button></div></div></article>)}</div>{visibleCourses.length === 0 && <div className="empty-state">No subjects match your search or filter.</div>}</div> }

function CoursePage({ course, onBack, onLesson, onAssessment }: { course: Course; onBack: () => void; onLesson: () => void; onAssessment: (mode: AssessmentMode) => void }) { return <div className="page-container"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Back to subjects</button><section className="course-hero"><div className={`course-hero-art ${course.color}`}><span>{course.icon}</span></div><div className="course-hero-copy"><span className="course-category">{course.category}</span><h1>{course.title}</h1><p>{course.description}</p><div className="course-author"><div className="teacher-avatar">{course.teacher.split(' ').map((part) => part[0]).join('')}</div><span>Created by <strong>{course.teacher}</strong></span></div><button className="primary-button" onClick={onLesson}><CirclePlay size={16} /> Resume course</button></div><div className="course-progress-card"><span>Your progress</span><strong>{course.progress}%</strong><div className="progress-track"><span style={{ width: `${course.progress}%` }} /></div><small>{Math.round(course.lessons * course.progress / 100)} of {course.lessons} lessons complete</small></div></section><div className="course-layout"><main><section className="learning-objectives"><p className="eyebrow">Course introduction</p><h2>What you will learn</h2><div className="objective-grid"><span><CheckCircle2 size={16} /> Solve equations with confidence</span><span><CheckCircle2 size={16} /> Apply concepts to real problems</span><span><CheckCircle2 size={16} /> Explain your thinking clearly</span><span><CheckCircle2 size={16} /> Prepare for the final assessment</span></div></section><div className="module-heading"><div><p className="eyebrow">Course curriculum</p><h2>Modules and lessons</h2></div><span>4 modules · {course.lessons} lessons</span></div><section className="module-card"><div className="module-title"><div><span>Module 1</span><h3>Building your foundation</h3></div><strong>2 / 4</strong></div>{lessons.map((lesson, index) => <button className={`lesson-row ${lesson.completed ? 'is-complete' : ''}`} key={lesson.title} onClick={index === 2 ? onLesson : undefined}><span className="lesson-status">{lesson.completed ? <Check size={14} /> : index === 2 ? <Play size={13} fill="currentColor" /> : index === 3 ? <Target size={14} /> : <LockKeyhole size={13} />}</span><span className="lesson-name"><strong>{lesson.title}</strong><small>{lesson.type} · {lesson.duration}</small></span>{index === 2 && <span className="now-badge">Up next</span>}<ChevronRight size={16} /></button>)}</section></main><aside className="course-aside"><div className="panel"><div className="section-heading compact"><h2>Course tools</h2><MoreHorizontal size={17} /></div><button className="tool-link" onClick={() => onAssessment('practice')}><ListChecks size={16} />Practice quiz<ChevronRight size={15} /></button><button className="tool-link" onClick={() => onAssessment('exam')}><Timer size={16} />Final exam · 15 min<ChevronRight size={15} /></button><button className="tool-link"><Download size={16} />Download materials<ChevronRight size={15} /></button><button className="tool-link"><NotebookPen size={16} />My notes<ChevronRight size={15} /></button><button className="tool-link"><Award size={16} />Certificate requirements<ChevronRight size={15} /></button></div><div className="panel certificate-panel"><Award size={23} /><strong>Certificate ready to earn</strong><span>Complete all lessons and the final assessment.</span></div></aside></div></div> }

function LessonPage({ course, completed, setCompleted, bookmarked, setBookmarked, note, setNote, onBack }: { course: Course; completed: boolean; setCompleted: (value: boolean) => void; bookmarked: boolean; setBookmarked: (value: boolean) => void; note: string; setNote: (value: string) => void; onBack: () => void }) { return <div className="lesson-page"><div className="lesson-top"><button className="back-button" onClick={onBack}><ChevronLeft size={16} /> {course.title}</button><div className="lesson-progress"><span>Lesson 3 of 18</span><div className="progress-track"><span style={{ width: '17%' }} /></div></div><span className="lesson-percent">17%</span></div><div className="lesson-layout"><main className="lesson-content"><div className="lesson-kicker"><span>Module 1 · Lesson 3</span><span><Clock3 size={14} /> 22 min</span></div><h1>Solving one-step equations</h1><p className="lesson-intro">An equation is a statement that two expressions are equal. Today we will learn a simple, reliable way to find the value of an unknown.</p><div className="video-placeholder"><div className="video-glow" /><button className="video-play" aria-label="Play lesson video"><Play size={24} fill="currentColor" /></button><span><Video size={14} /> Watch: The balance method · 06:42</span></div><h2>The balance method</h2><p>Think of an equation like a balanced scale. Whatever you do to one side, you must also do to the other side to keep it balanced.</p><div className="formula-card"><span>Example</span><strong>x + 4 = 11</strong><ArrowRight size={18} /><strong>x = 7</strong><small>Subtract 4 from both sides</small></div><div className="lesson-callout"><Sparkles size={18} /><div><strong>Remember</strong><span>Use the inverse operation to isolate the variable. Addition and subtraction are opposites.</span></div></div><h2>Try it yourself</h2><p>What is the value of x in the equation below?</p><div className="practice-card"><strong>3x = 18</strong><div className="practice-options"><button>3</button><button className="selected">6</button><button>9</button><button>12</button></div><span className="correct-answer"><CheckCircle2 size={15} /> Great work! The answer is 6.</span></div><div className="lesson-actions"><button className={`bookmark-button ${bookmarked ? 'saved' : ''}`} onClick={() => setBookmarked(!bookmarked)}><Bookmark size={16} fill={bookmarked ? 'currentColor' : 'none'} /> {bookmarked ? 'Bookmarked' : 'Bookmark'}</button><button className="complete-button" onClick={() => setCompleted(!completed)}>{completed ? <CheckCircle2 size={16} /> : <Check size={16} />} {completed ? 'Completed' : 'Mark as completed'}</button></div><div className="lesson-notes"><div className="section-heading compact"><div><p className="eyebrow">Personal workspace</p><h2>My notes</h2></div><Send size={16} /></div><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Write a note about this lesson..." /><div className="notes-footer"><span>Saved automatically</span><button><Download size={14} /> Export notes</button></div></div><EdusphereAiPanel course={course} /></main><aside className="lesson-sidebar"><div className="lesson-outline panel"><p className="eyebrow">Course progress</p><h2>Algebra foundations</h2><div className="mini-progress"><span style={{ width: '68%' }} /></div><strong>12 of 18 lessons</strong>{lessons.map((item, index) => <div className={`outline-row ${index === 2 ? 'current' : ''}`} key={item.title}><span>{item.completed ? <Check size={12} /> : index === 2 ? <Play size={11} fill="currentColor" /> : <LockKeyhole size={11} />}</span>{item.title}</div>)}<div className="outline-more">+ 3 more lessons</div></div><div className="panel resources-panel"><h2>Resources</h2><button><FileText size={16} />Lesson worksheet <Download size={14} /></button><button><ImageIcon size={16} />Formula reference <Download size={14} /></button><button><Code2 size={16} />Worked examples <Download size={14} /></button></div></aside></div><div className="lesson-bottom"><button onClick={onBack}><ChevronLeft size={16} /> Previous lesson</button><button className="next-lesson" onClick={() => setCompleted(true)}>Next lesson <ArrowRight size={16} /></button></div></div> }

function AssessmentPage({ mode, onBack, onSubmit }: { mode: AssessmentMode; onBack: () => void; onSubmit: (result: AssessmentResult) => void }) {
    const [current, setCurrent] = useState(0)
    const [answers, setAnswers] = useState<Record<number, string>>({})
    const [secondsLeft, setSecondsLeft] = useState(mode === 'exam' ? 15 * 60 : 0)
    const question = quizQuestions[current]
    const isLast = current === quizQuestions.length - 1
    useEffect(() => { if (mode !== 'exam' || secondsLeft <= 0) return; const timer = window.setInterval(() => setSecondsLeft((seconds) => seconds - 1), 1000); return () => window.clearInterval(timer) }, [mode, secondsLeft])
    useEffect(() => { if (mode === 'exam' && secondsLeft === 0) submit() }, [secondsLeft])
    function updateAnswer(value: string) { setAnswers((previous) => ({ ...previous, [question.id]: value })) }
    function submit() { const correct = quizQuestions.filter((item) => (answers[item.id] || '').trim().toLowerCase() === item.answer.toLowerCase()).length; onSubmit({ mode, correct, total: quizQuestions.length, score: Math.round(correct / quizQuestions.length * 100), completedAt: new Date().toISOString(), answers }) }
    const minutes = Math.floor(secondsLeft / 60).toString().padStart(2, '0'); const seconds = (secondsLeft % 60).toString().padStart(2, '0')
    return <div className="assessment-page"><div className="assessment-header"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Leave {mode === 'exam' ? 'exam' : 'practice'}</button><div className="assessment-title"><span className="eyebrow">Algebra foundations</span><h1>{mode === 'exam' ? 'Final assessment' : 'Practice: equations'}</h1></div>{mode === 'exam' ? <div className={`assessment-timer ${secondsLeft < 60 ? 'urgent' : ''}`}><Timer size={16} /><strong>{minutes}:{seconds}</strong><span>remaining</span></div> : <span className="practice-label"><RotateCcw size={14} /> Practice mode</span>}</div><div className="assessment-layout"><main className="assessment-card"><div className="question-meta"><span>Question {current + 1} of {quizQuestions.length}</span><span>{question.type.replace('-', ' ')}</span></div><div className="assessment-progress"><span style={{ width: `${(current + 1) / quizQuestions.length * 100}%` }} /></div><h2>{question.prompt}</h2><AnswerInput question={question} value={answers[question.id] || ''} onChange={updateAnswer} /><div className="question-actions"><button className="secondary-button" disabled={current === 0} onClick={() => setCurrent((value) => value - 1)}><ChevronLeft size={16} /> Previous</button>{isLast ? <button className="complete-button" onClick={submit}>Submit {mode === 'exam' ? 'exam' : 'quiz'} <Check size={16} /></button> : <button className="primary-button" onClick={() => setCurrent((value) => value + 1)}>Next question <ChevronRight size={16} /></button>}</div></main><aside className="question-nav panel"><p className="eyebrow">Question navigator</p><h2>{mode === 'exam' ? 'Exam in progress' : 'Practice set'}</h2><div className="question-grid">{quizQuestions.map((item, index) => <button key={item.id} className={`${index === current ? 'current' : ''} ${answers[item.id] ? 'answered' : ''}`} onClick={() => setCurrent(index)}>{index + 1}</button>)}</div><div className="question-legend"><span><i className="current-dot" />Current</span><span><i className="answered-dot" />Answered</span></div><div className="assessment-note"><Sparkles size={16} /><span>{mode === 'exam' ? 'Your exam submits automatically when the timer reaches zero.' : 'Practice mode is untimed. Use it to strengthen one topic at a time.'}</span></div></aside></div></div>
}

function AnswerInput({ question, value, onChange }: { question: Question; value: string; onChange: (value: string) => void }) {
    if (question.type === 'fill-blank' || question.type === 'short-answer' || question.type === 'programming') return <div className={question.type === 'programming' ? 'code-answer' : ''}><textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={question.type === 'programming' ? 'Write your answer here...' : 'Type your answer...'} /></div>
    return <div className="answer-options">{question.options?.map((option) => <button key={option} className={value === option ? 'selected' : ''} onClick={() => onChange(option)}><span>{value === option ? <Check size={15} /> : ''}</span>{option}</button>)}</div>
}

function ResultsPage({ userName, result, onRetry, onBack }: { userName: string; result: AssessmentResult; onRetry: () => void; onBack: () => void }) { const passed = result.score >= 70; return <div className="results-page"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Back to course</button><div className="results-heading"><div className={`result-medal ${passed ? 'passed' : ''}`}><Award size={36} /></div><p className="eyebrow">{result.mode === 'exam' ? 'Final assessment complete' : 'Practice complete'}</p><h1>{passed ? 'Excellent work, ' + userName + '.' : 'Keep practicing, ' + userName + '.'}</h1><p>{passed ? 'You have strengthened your understanding of one-step equations.' : 'Review the explanations below and try this set again.'}</p></div><div className="results-grid"><div className="result-score-card"><span>Your score</span><strong>{result.score}%</strong><div className="score-ring" style={{ '--score': `${result.score * 3.6}deg` } as CSSProperties}><div>{result.correct}<small>/{result.total}</small></div></div><span>{result.correct} correct answers</span></div><div className="result-details panel"><div className="section-heading compact"><div><p className="eyebrow">Your progress</p><h2>What happens next</h2></div><CheckCircle2 size={20} color="#50aa7e" /></div><div className="result-stat"><BookOpen size={17} /><span>Subject progress</span><strong>+8%</strong></div><div className="result-stat"><Flame size={17} /><span>Learning streak</span><strong>6 days</strong></div><div className="result-stat"><Trophy size={17} /><span>Achievement unlocked</span><strong>{result.score === 100 ? 'Quiz Master' : 'Practice completed'}</strong></div><div className="result-actions"><button className="secondary-button" onClick={onRetry}><RotateCcw size={15} /> Try again</button><button className="primary-button" onClick={onBack}>Continue learning <ArrowRight size={15} /></button></div></div></div><section className="review-panel"><div className="section-heading"><div><p className="eyebrow">Review</p><h2>Learn from your answers</h2></div><span>{result.score}% complete</span></div>{quizQuestions.map((question, index) => { const submittedAnswer = result.answers[question.id] || 'No answer'; const isCorrect = submittedAnswer.trim().toLowerCase() === question.answer.toLowerCase(); return <div className="review-row" key={question.id}><span className="review-number">{index + 1}</span><div><strong>{question.prompt}</strong><small className={isCorrect ? 'answer-correct' : 'answer-wrong'}>{isCorrect ? 'Correct' : `Your answer: ${submittedAnswer} · Correct answer: ${question.answer}`}</small><p><Sparkles size={13} /> {question.explanation}</p></div>{isCorrect ? <CheckCircle2 size={17} color="#50aa7e" /> : <X size={17} color="#d85e55" />}</div> })}</section></div> }

function SchedulePanel() { return <section className="panel today-panel"><div className="section-heading compact"><div><p className="eyebrow">Your schedule</p><h2>Up next</h2></div><MoreHorizontal size={18} /></div><div className="up-next"><div className="time-block"><span>10:30</span><small>AM</small></div><div className="schedule-line"><i /><div><strong>Quadratic equations</strong><span>Mathematics · Lesson 7</span></div></div><button className="play-button"><Play size={15} fill="currentColor" /></button></div><div className="up-next"><div className="time-block"><span>2:00</span><small>PM</small></div><div className="schedule-line"><i className="green-dot" /><div><strong>Forces and motion</strong><span>Physics · Practice quiz</span></div></div><MoreHorizontal size={17} /></div><button className="calendar-link">Open calendar <ArrowRight size={15} /></button></section> }
function ActivityPanel() { return <section className="panel activity-panel"><div className="section-heading compact"><div><p className="eyebrow">This week</p><h2>Activity</h2></div><button className="text-button">Details <ArrowRight size={15} /></button></div><div className="activity-chart"><div className="chart-y"><span>4h</span><span>2h</span><span>0</span></div><div className="chart-bars">{[['M', 45], ['T', 72], ['W', 52], ['T', 88], ['F', 64], ['S', 30], ['S', 18]].map(([day, height], index) => <div className="bar-group" key={`${day}-${index}`}><div className={`bar ${index === 3 ? 'today' : ''}`} style={{ height: `${height}%` }} /><span>{day}</span></div>)}</div></div><div className="activity-total"><div><strong>4h 32m</strong><span>Total learning time</span></div><span className="trend-up">+12.4%</span></div></section> }

function AuthScreen({ mode, onModeChange, onSuccess }: { mode: AuthMode; onModeChange: (mode: AuthMode) => void; onSuccess: () => void }) { const [submitted, setSubmitted] = useState(false); return <div className="auth-shell"><div className="auth-visual"><div className="brand"><span className="brand-mark"><Sparkles size={18} /></span><span>Edu<span>Sphere</span></span></div><div className="auth-quote"><Sparkles size={22} /><h1>Make learning<br /><em>your superpower.</em></h1><p>One focused lesson at a time. Build the skills and confidence to go further.</p></div><div className="auth-orbit" /></div><main className="auth-form-wrap"><div className="auth-form"><div className="mobile-auth-brand brand"><span className="brand-mark"><Sparkles size={18} /></span><span>Edu<span>Sphere</span></span></div><div className="auth-heading"><p className="eyebrow">{mode === 'login' ? 'Welcome back' : 'Start learning today'}</p><h2>{mode === 'login' ? 'Sign in to your account' : 'Create your student account'}</h2><p>{mode === 'login' ? 'Continue your learning journey right where you left off.' : 'A few details, then your learning path is ready.'}</p></div>{submitted ? <div className="auth-success"><CheckCircle2 size={34} /><h3>You are all set!</h3><p>Your account is ready. Let us get you learning.</p><button className="primary-button" onClick={onSuccess}>Open my dashboard <ArrowRight size={15} /></button></div> : <form onSubmit={(event) => { event.preventDefault(); setSubmitted(true) }}>{mode === 'register' && <label>Full name<input required placeholder="Your name" /></label>}<label>Email address<input required type="email" placeholder="you@example.com" /></label><label>Password<div className="password-input"><input required type="password" placeholder="At least 8 characters" /><LockKeyhole size={15} /></div></label>{mode === 'register' && <div className="form-row"><label>Country<select defaultValue=""><option value="" disabled>Select country</option><option>Rwanda</option><option>Kenya</option><option>United States</option><option>France</option></select></label><label>Education level<select defaultValue=""><option value="" disabled>Select level</option><option>Secondary school</option><option>University</option><option>Professional</option></select></label></div>}{mode === 'register' && <div className="form-row"><label>School / class<input placeholder="e.g. Senior 4" /></label><label>Preferred language<select defaultValue="English"><option>English</option><option>French</option><option>Kinyarwanda</option></select></label></div>}<button className="primary-button auth-submit" type="submit">{mode === 'login' ? <><LogIn size={16} /> Sign in</> : <><Plus size={16} /> Create account</>}</button>{mode === 'login' && <button className="forgot-link" type="button">Forgot your password?</button>}<div className="auth-divider"><span>or</span></div><button className="social-button" type="button">Continue with Google</button></form>}<p className="auth-switch">{mode === 'login' ? "Don't have an account?" : 'Already have an account?'} <button onClick={() => { onModeChange(mode === 'login' ? 'register' : 'login'); setSubmitted(false) }}>{mode === 'login' ? 'Create one' : 'Sign in'}</button></p><p className="secure-note"><LockKeyhole size={13} /> Your information is encrypted and secure.</p></div></main></div> }

void AuthScreen

function ApiAuthScreen({ mode, onModeChange, onSuccess }: { mode: AuthMode; onModeChange: (mode: AuthMode) => void; onSuccess: (session: ApiSession) => void }) {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [fullName, setFullName] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [isAnimationComplete, setIsAnimationComplete] = useState(false)
    const passwordScore = [password.length >= 12, /[a-z]/.test(password) && /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password), password.length >= 16].filter(Boolean).length
    const strength = passwordScore >= 5 ? 'strong' : passwordScore >= 4 ? 'good' : passwordScore >= 2 ? 'fair' : passwordScore > 0 ? 'weak' : 'empty'

    async function submit(event: FormEvent) {
        event.preventDefault()
        setError('')
        setMessage('')
        if (mode === 'register' && password.length < 12) {
            setError('Use a password with at least 12 characters.')
            return
        }
        if (mode === 'register' && password !== confirmPassword) {
            setError('Your passwords do not match.')
            return
        }
        setSubmitting(true)
        try {
            if (mode === 'login') {
                const session = await api.login({ email: email.trim(), password })
                onSuccess(session)
            } else {
                const result = await api.register({ email: email.trim(), password, fullName: fullName.trim() })
                setMessage(result.message)
                setPassword('')
                setConfirmPassword('')
            }
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Unable to reach the server')
        } finally {
            setSubmitting(false)
        }
    }

    function switchMode() {
        onModeChange(mode === 'login' ? 'register' : 'login')
        setError('')
        setMessage('')
        setPassword('')
        setConfirmPassword('')
    }

    return <div className={`auth-shell auth-scene ${isAnimationComplete ? 'is-animation-complete' : ''}`}>
        <div className="auth-visual">
            <LoginImpactScene onReveal={() => setIsAnimationComplete(true)} />
            <div className="brand"><span className="brand-mark"><Sparkles size={18} /></span><span>Edu<span>Sphere</span></span></div>
            <div className="auth-quote"><Sparkles size={22} /><h1>Make learning<br /><em>your superpower.</em></h1><p>Your account, progress, and learning community in one secure place.</p></div>
            <div className="auth-orbit" />
        </div>
        <main className="auth-form-wrap">
            <div className={`auth-form ${isAnimationComplete ? 'is-revealed' : ''}`}>
                <div className="mobile-auth-brand brand"><span className="brand-mark"><Sparkles size={18} /></span><span>Edu<span>Sphere</span></span></div>
                <div className="auth-heading">
                    <p className="eyebrow">{mode === 'login' ? 'Welcome back' : 'Start learning today'}</p>
                    <h2>{mode === 'login' ? 'Sign in to your account' : 'Create your student account'}</h2>
                    <p>{mode === 'login' ? 'Continue your learning journey right where you left off.' : 'Your secure learning profile starts here.'}</p>
                </div>
                {error && <div className="auth-error" role="alert"><X size={15} /> {error}</div>}
                {message && <div className="auth-message" role="status"><CheckCircle2 size={15} /> {message}</div>}
                <form onSubmit={submit}>
                    {mode === 'register' && <label>Full name<input required minLength={2} maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="e.g. Aline Uwase" autoComplete="name" /></label>}
                    <label>Email address<input required value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@example.com" autoComplete="email" /></label>
                    <label>Password
                        <div className="password-input"><input required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} placeholder="At least 12 characters" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /><button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
                        {mode === 'register' && <div className="auth-password-feedback"><span>Use 12+ characters and mix letter cases, numbers, or symbols.</span><div className={`auth-password-meter strength-${strength}`} role="progressbar" aria-label="Password strength" aria-valuemin={0} aria-valuemax={5} aria-valuenow={passwordScore}>{Array.from({ length: 5 }, (_, index) => <i key={index} className={index < passwordScore ? 'filled' : ''} />)}</div><small>{password ? `${strength[0].toUpperCase()}${strength.slice(1)} password` : 'Password strength'}</small></div>}
                    </label>
                    {mode === 'register' && <label>Confirm password<input required minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type={showPassword ? 'text' : 'password'} placeholder="Enter your password again" autoComplete="new-password" /></label>}
                    {mode === 'login' && <span className="forgot-row"><button className="forgot-link" type="button" onClick={() => setMessage('Use the password reset link from the API to recover your account.')}>Forgot your password?</button></span>}
                    <button className="primary-button auth-submit" disabled={submitting} type="submit"><span className="auth-spinner" aria-hidden="true" />{submitting ? 'Connecting...' : mode === 'login' ? <><LogIn size={16} /> Sign in</> : <><Plus size={16} /> Create account</>}</button>
                </form>
                <p className="auth-switch">{mode === 'login' ? "Don't have an account?" : 'Already have an account?'} <button type="button" onClick={switchMode}>{mode === 'login' ? 'Create one' : 'Sign in'}</button></p>
                <p className="secure-note"><LockKeyhole size={13} /> Secure connection | EduSphere authentication</p>
            </div>
        </main>
    </div>
}

void ApiAuthScreen

function EdusphereAiPanel({ course }: { course: Course }) {
    const [message, setMessage] = useState('')
    const [answer, setAnswer] = useState('')
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [educationLevel, setEducationLevel] = useState(() => localStorage.getItem('edusphere-education-level') || 'Secondary 5')
    function updateEducationLevel(value: string) { setEducationLevel(value); localStorage.setItem('edusphere-education-level', value) }
    async function ask(question = message) {
        if (!question.trim()) return
        setBusy(true); setError('')
        try {
            const result = await api.aiChat({ message: question, educationLevel, subject: course.category, course: course.title, module: 'Module 1 · Foundations', lesson: 'Solving one-step equations' })
            setAnswer(result.data.answer); setMessage('')
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'Edusphere AI is temporarily unavailable. Please try again.') }
        finally { setBusy(false) }
    }
    return <section className="lesson-ai-panel"><div className="section-heading compact"><div><p className="eyebrow"><Sparkles size={14} /> Learning assistant</p><h2>Ask Edusphere AI</h2></div><span className="status-pill published">Context aware</span></div><p>Ask for a simpler explanation, an example, practice questions, or a summary of this lesson.</p><label className="ai-level-field">Education level<select value={educationLevel} onChange={(event) => updateEducationLevel(event.target.value)}>{educationLevels.map((level) => <option key={level}>{level}</option>)}</select></label><div className="ai-quick-actions"><button onClick={() => void ask('Explain this lesson in a simpler way.')}>Explain simpler</button><button onClick={() => void ask('Give me a practical example.')}>Give example</button><button onClick={() => void ask('Create five practice questions.')}>Practice questions</button><button onClick={() => void ask('Summarize the key points.')}>Summarize</button></div><div className="ai-input-row"><input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void ask() }} placeholder="Ask about this lesson..." aria-label="Ask Edusphere AI" /><button className="primary-button" disabled={busy || !message.trim()} onClick={() => void ask()}>{busy ? 'Thinking...' : <><Send size={15} /> Ask AI</>}</button></div>{error && <p className="auth-error" role="alert">{error}</p>}{answer && <div className="ai-answer"><strong>Edusphere AI</strong><p>{answer}</p></div>}</section>
}

export default App
