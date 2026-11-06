export type ApiErrorBody = { message?: string; error?: { message?: string; details?: unknown } }
export type ApiSession = { accessToken: string; user: { id: string; email: string; fullName: string; role: 'student' | 'teacher' | 'admin' | 'super-admin' } }
export type ApiCourse = { id: string; title: string; description: string; difficulty: string; subject: string; subject_id?: string; teacher: string | null; lessons: number; education_level_id?: string | null; grade_id?: string | null; program_id?: string | null }
export type ApiCourseDetail = ApiCourse & { modules: Array<{ id: string; title: string; position: number; lessons: Array<{ id: string; title: string; content: unknown; durationMinutes: number; position: number }> }> }
export type AssessmentQuestion = { id: string; type: string; prompt: string; explanation: string; marks: number; position: number; options: Array<{ id: string; text: string }> }
export type AssessmentDetail = { id: string; title: string; instructions?: string; time_limit_seconds?: number | null; course_id: string; lesson_id?: string | null; questions: AssessmentQuestion[] }
export type ApiProgress = { course_id: string; title: string; total_lessons: number; completed_lessons: number; progress: number }
export type LearningSummary = { profile: EducationProfile | null; coursesStarted: number; coursesCompleted: number; lessonsCompleted: number; overallProgress: number; courses: Array<{ id: string; title: string; subject: string; total_lessons: number; completed_lessons: number; seconds_spent: number; progress: number; education_level_id?: string | null; grade_id?: string | null; program_id?: string | null }>; scores: Array<{ type: string; average_score: number; attempts: number }>; homework: Array<{ id: string; course_id: string; title: string; due_at: string; status: string; score?: number | null }>; recentActivity: Array<{ activity_type: string; title: string; occurred_at: string }>; learningStreak: number; achievements: Array<{ key: string; name: string; description: string; earned_at: string }> }
export type EducationTaxonomy = { levels: Array<{ id: string; name: string; code: string; category?: string }>; grades: Array<{ id: string; education_level_id: string; name: string; code: string }>; faculties: Array<{ id: string; name: string; description: string }>; programs: Array<{ id: string; name: string; description: string; department?: string; faculty?: string; grade_ids?: string[] }>; subjects: Array<{ id: string; name: string }> }
export type EducationProfile = { education_level_id: string | null; grade_id: string | null; program_id: string | null; school_id?: string | null; school_name?: string | null; subject_combination_id?: string | null; subject_combination_name?: string | null; education_level_category?: string; school_assignment_required?: boolean; school_status?: string | null; education_level_name?: string; grade_name?: string | null; program_name?: string | null }
export type SubjectNote = { id: string; title: string; topic: string; body: string; created_at: string; updated_at?: string; subject_name?: string; attachments?: SubjectNoteAttachment[] }
export type SubjectNoteAttachment = { id: string; name: string; type: string; size: number }
export type LearningMaterial = { id: string; title: string; description: string; material_type: string; source_type: 'upload' | 'url'; url: string; original_filename?: string; subject_name?: string; unit_name?: string; lesson_name?: string }
export type LearningNote = { id: string; title: string; body: string; lesson_id: string; course_title: string }
export type LearningDashboard = { profile: EducationProfile | null; curriculum: Array<{ id: string; code: string; name: string; description: string; source_reference: string; version_label: string; effective_from?: string | null; authority: string; source_title: string; source_url: string }>; subjects: Array<{ id: string; name: string; description: string }>; courses: ApiCourse[]; materials: LearningMaterial[]; units: Array<{ id: string; title: string; description: string; subject_name: string }>; outcomes: Array<{ id: string; description: string; unit_title: string }>; notes: LearningNote[]; subjectNotes: SubjectNote[]; exercises: unknown[]; quizzes: unknown[]; tests: unknown[]; exams: unknown[]; homework: unknown[]; results: unknown[]; progress: unknown[] }
export type TvetDashboard = { profile: EducationProfile | null; subjects: unknown[]; competences: unknown[]; modules: unknown[]; units: unknown[]; learningOutcomes: Array<{ id: string; description: string; unit_id: string; unit_title: string }>; lessons: unknown[]; practicalExercises: unknown[]; assessments: Array<{ id: string; type: string; title: string }>; materials: LearningMaterial[]; notes: unknown[]; exercises: unknown[]; quizzes: unknown[]; tests: unknown[]; exams: unknown[]; assignments: unknown[]; results: unknown[]; progress: unknown[] }
export type UniversityDashboard = { profile: EducationProfile | null; program: unknown; years: unknown[]; semesters: unknown[]; courses: Array<ApiCourse & { course_code?: string; credits?: number; year_id?: string; semester_id?: string }>; modules: unknown[]; lessons: unknown[]; notes: unknown[]; exercises: unknown[]; quizzes: unknown[]; tests: unknown[]; exams: unknown[]; results: unknown[]; progress: unknown[] }
type BackendSession = { accessToken?: string; token?: string; user: { id: string; fullName?: string; name?: string; email: string; role: ApiSession['user']['role'] }; message?: string }

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim()
const API_BASE = configuredApiUrl ? `${configuredApiUrl.replace(/\/$/, '').replace(/\/api$/, '')}/api` : '/api'
let accessToken: string | null = sessionStorage.getItem('edusphere-access-token')

export function setAccessToken(token: string | null) { accessToken = token; if (token) sessionStorage.setItem('edusphere-access-token', token); else sessionStorage.removeItem('edusphere-access-token') }
export function getAccessToken() { return accessToken }
const USER_SESSION_KEY = 'edusphere-user-session'
export function getStoredUser(): ApiSession['user'] | null { const stored = sessionStorage.getItem(USER_SESSION_KEY); return stored ? JSON.parse(stored) as ApiSession['user'] : null }
export function setStoredUser(user: ApiSession['user'] | null) { if (user) sessionStorage.setItem(USER_SESSION_KEY, JSON.stringify(user)); else sessionStorage.removeItem(USER_SESSION_KEY) }

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const headers = new Headers(init.headers)
    if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
    let response: Response
    try {
        response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' })
    } catch {
        throw new Error('Unable to connect to the server. Check that the API is running and VITE_API_URL is correct.')
    }
    if (response.status === 401 && retry && path !== '/auth/refresh') {
        const refreshed = await request<{ accessToken: string }>('/auth/refresh', { method: 'POST' }, false).catch(() => null)
        if (refreshed) { setAccessToken(refreshed.accessToken); return request<T>(path, init, false) }
        setAccessToken(null)
    }
    if (!response.ok) {
        const body = await response.json().catch(() => ({})) as ApiErrorBody
        if (response.status >= 500) throw new Error(body.error?.message || body.message || 'Server error. Please try again.')
        if (response.status === 401) throw new Error(path === '/auth/login' ? 'Invalid email or password.' : 'Your session has expired.')
        if (response.status === 403 && body.error?.message?.toLowerCase().includes('session')) throw new Error('Your session has expired.')
        throw new Error(body.message || body.error?.message || 'The request could not be completed.')
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
}

async function uploadSubjectNoteFile(file: File): Promise<SubjectNoteAttachment> {
    const body = new FormData()
    body.append('file', file)
    const headers = new Headers()
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
    let response: Response
    try { response = await fetch(`${API_BASE}/uploads/subject-note-attachments`, { method: 'POST', headers, body, credentials: 'include' }) }
    catch { throw new Error('Unable to connect to the server while uploading the file.') }
    const result = await response.json().catch(() => ({})) as { data?: SubjectNoteAttachment; message?: string; error?: { message?: string } }
    if (!response.ok || !result.data) throw new Error(result.error?.message || result.message || 'The attachment could not be uploaded.')
    return { ...result.data, id: String(result.data.id), size: Number(result.data.size) }
}

async function uploadLearningMaterial(input: Record<string, unknown>, file: File) {
    const body = new FormData()
    body.append('file', file)
    for (const [key, value] of Object.entries(input)) {
        if (value !== null && value !== undefined) body.append(key, String(value))
    }
    const headers = new Headers()
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
    let response: Response
    try { response = await fetch(`${API_BASE}/admin/learning-materials/upload`, { method: 'POST', headers, body, credentials: 'include' }) }
    catch { throw new Error('Unable to connect to the server while uploading the PDF.') }
    const result = await response.json().catch(() => ({})) as { data?: Record<string, unknown>; message?: string }
    if (!response.ok || !result.data) throw new Error(result.message || 'The PDF could not be uploaded.')
    return result.data
}

async function replaceLearningMaterialFile(id: string, input: Record<string, unknown>, file: File) {
    const body = new FormData()
    body.append('file', file)
    for (const [key, value] of Object.entries(input)) {
        if (value !== null && value !== undefined) body.append(key, String(value))
    }
    const headers = new Headers()
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
    let response: Response
    try { response = await fetch(`${API_BASE}/admin/learning-materials/${encodeURIComponent(id)}/replace`, { method: 'POST', headers, body, credentials: 'include' }) }
    catch { throw new Error('Unable to connect to the server while replacing the PDF.') }
    const result = await response.json().catch(() => ({})) as { data?: Record<string, unknown>; message?: string }
    if (!response.ok || !result.data) throw new Error(result.message || 'The PDF could not be replaced.')
    return result.data
}

async function privateLearningMaterialFile(path: string): Promise<Blob> {
    const fetchFile = () => {
        const headers = new Headers()
        if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
        return fetch(`${API_BASE}${path}`, { headers, credentials: 'include' })
    }
    let response: Response
    try { response = await fetchFile() }
    catch { throw new Error('Unable to connect to the server while loading the learning material.') }
    if (response.status === 401) {
        const refreshed = await request<{ accessToken: string }>('/auth/refresh', { method: 'POST' }, false).catch(() => null)
        if (refreshed?.accessToken) {
            setAccessToken(refreshed.accessToken)
            try { response = await fetchFile() }
            catch { throw new Error('Unable to connect to the server while loading the learning material.') }
        }
    }
    if (!response.ok) {
        const body = await response.json().catch(() => ({})) as ApiErrorBody
        throw new Error(body.error?.message || body.message || 'The learning material could not be loaded.')
    }
    return response.blob()
}

export const api = {
    register: (input: { email: string; password: string; fullName: string }) => request<{ user: unknown; message: string; verificationToken?: string }>('/auth/register', { method: 'POST', body: JSON.stringify({ ...input, name: input.fullName }) }),
    login: async (input: { email: string; password: string }) => { const response = await request<BackendSession>('/auth/login', { method: 'POST', body: JSON.stringify(input) }); const accessToken = response.accessToken || response.token; if (!accessToken) throw new Error('The server returned an invalid sign-in response.'); const session: ApiSession = { accessToken, user: { id: response.user.id, email: response.user.email, fullName: response.user.fullName || response.user.name || response.user.email.split('@')[0], role: response.user.role } }; setAccessToken(session.accessToken); setStoredUser(session.user); return session },
    currentUser: () => request<{ data: ApiSession['user'] }>('/auth/me'),
    logout: async () => { try { await request<void>('/auth/logout', { method: 'POST' }) } finally { setAccessToken(null); setStoredUser(null) } },
    subjects: () => request<{ data: unknown[] }>('/learning/subjects'),
    taxonomy: () => request<{ data: EducationTaxonomy }>('/learning/taxonomy'),
    educationProfile: () => request<{ data: EducationProfile | null }>('/student/me/education-profile'),
    educationSchools: () => request<{ data: Array<{ id: string; name: string }> }>('/learning/schools'),
    learningSummary: () => request<{ data: LearningSummary }>('/student/me/learning-summary'),
    learningDashboard: () => request<{ data: LearningDashboard }>('/student/me/learning-dashboard'),
    tvetDashboard: () => request<{ data: TvetDashboard }>('/student/me/tvet-dashboard'),
    universityDashboard: () => request<{ data: UniversityDashboard }>('/student/me/university-dashboard'),
    resetEducationProfile: () => request<void>('/student/me/education-profile', { method: 'DELETE' }),
    updateEducationProfile: (input: { educationLevelId: string; gradeId?: string | null; programId?: string | null; schoolId: string }) => request<{ data: EducationProfile }>('/student/me/education-profile', { method: 'PATCH', body: JSON.stringify(input) }),
    studentSubjectNotes: (subjectId: string) => request<{ data: SubjectNote[] }>(`/student/subjects/${encodeURIComponent(subjectId)}/notes`),
    uploadSubjectNoteFile,
    downloadSubjectNoteFile: async (id: string, name: string) => {
        const headers = new Headers()
        if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
        let response: Response
        try { response = await fetch(`${API_BASE}/student/subject-note-attachments/${encodeURIComponent(id)}`, { headers, credentials: 'include' }) }
        catch { throw new Error('Unable to connect to the server while downloading the file.') }
        if (!response.ok) {
            const body = await response.json().catch(() => ({})) as ApiErrorBody
            throw new Error(body.error?.message || body.message || 'The attachment could not be downloaded.')
        }
        const objectUrl = URL.createObjectURL(await response.blob())
        const link = document.createElement('a')
        link.href = objectUrl
        link.download = name
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    },
    courses: (search?: string, filters?: { level?: string; grade?: string; program?: string }) => { const params = new URLSearchParams(); if (search) params.set('search', search); if (filters?.level) params.set('level', filters.level); if (filters?.grade) params.set('grade', filters.grade); if (filters?.program) params.set('program', filters.program); return request<{ data: ApiCourse[] }>(`/learning/courses${params.size ? `?${params.toString()}` : ''}`) },
    search: (query: string) => request<{ data: unknown[] }>(`/learning/search?q=${encodeURIComponent(query)}`),
    course: (courseId: string) => request<{ data: ApiCourseDetail | null }>(`/learning/courses/${courseId}`),
    quiz: (quizId: string) => request<{ data: AssessmentDetail | null }>(`/learning/quizzes/${quizId}`),
    test: (testId: string) => request<{ data: AssessmentDetail | null }>(`/learning/tests/${testId}`),
    exam: (examId: string) => request<{ data: AssessmentDetail | null }>(`/learning/exams/${examId}`),
    progress: () => request<{ data: ApiProgress[] }>('/learning/me/progress'),
    aiChat: (input: { message: string; history?: Array<{ role: 'user' | 'assistant'; content: string }>; conversationId?: string; courseId?: string; lessonId?: string; educationLevel?: string; classProgram?: string; subject?: string; course?: string; module?: string; lesson?: string; language?: string }) => request<{ data: { conversationId: string | null; answer: string; citations?: Array<{ id: string; title: string; reference: string; url: string }> } }>('/ai/chat', { method: 'POST', body: JSON.stringify(input) }),
    aiGenerate: (input: { kind: string; topic: string; educationLevel?: string; instructions?: string; language?: string }) => request<{ data: { id: string | null; title: string; content: { markdown: string }; status: string } }>('/ai/generate', { method: 'POST', body: JSON.stringify({ ...input, educationLevel: input.educationLevel || localStorage.getItem('edusphere-education-level') || 'Secondary 5' }) }),
    aiDrafts: () => request<{ data: Array<{ id: string | number; kind: string; title: string; content: { markdown: string }; status: string }> }>('/ai/drafts'),
    updateAiDraft: (id: string | number, input: { title: string; markdown: string }) => request<{ data: unknown }>(`/ai/drafts/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    publishAiDraft: (id: string | number) => request<{ data: unknown }>(`/ai/drafts/${id}/publish`, { method: 'POST' }),
    enroll: (courseId: string) => request('/learning/courses/' + courseId + '/enroll', { method: 'POST' }),
    saveLessonProgress: (lessonId: string, completed: boolean, secondsSpent: number) => request('/learning/lessons/' + lessonId + '/progress', { method: 'POST', body: JSON.stringify({ completed, secondsSpent }) }),
    lessonNote: (lessonId: string) => request<{ data: { id: string; lesson_id: string; body: string; updated_at: string } | null }>(`/student/notes/${lessonId}`),
    saveBookmark: (lessonId: string, bookmarked: boolean) => request('/student/bookmarks/' + lessonId, { method: bookmarked ? 'PUT' : 'DELETE' }),
    saveNote: (lessonId: string, body: string) => request('/student/notes/' + lessonId, { method: 'PUT', body: JSON.stringify({ body }) }),
    submitQuiz: (quizId: string, answers: Record<string, string>) => request<{ data: { id: string; score: number; submitted_at: string; review: Array<{ questionId: string; submitted: string; isCorrect: boolean; explanation: string }> } }>('/student/quizzes/' + quizId + '/attempts', { method: 'POST', body: JSON.stringify({ answers }) }),
    quizAttempts: (quizId: string) => request<{ data: Array<{ id: string; answers: Record<string, string>; score: number; submitted_at: string }> }>(`/student/quizzes/${quizId}/attempts`),
    assignments: (courseId?: string) => request<{ data: unknown[] }>(`/student/assignments${courseId ? `?courseId=${encodeURIComponent(courseId)}` : ''}`),
    submitAssignment: (assignmentId: string, content: unknown) => request('/student/assignments/' + assignmentId + '/submissions', { method: 'POST', body: JSON.stringify({ content }) }),
    submitExam: (examId: string, answers: Record<string, string>) => request<{ data: { id: string; score: number; submitted_at: string; review: Array<{ questionId: string; submitted: string; isCorrect: boolean; explanation: string }> } }>('/student/exams/' + examId + '/attempts', { method: 'POST', body: JSON.stringify({ answers }) }),
    submitTest: (testId: string, answers: Record<string, string>) => request<{ data: { id: string; score: number; submitted_at: string; review: Array<{ questionId: string; submitted: string; isCorrect: boolean; explanation: string }> } }>(`/student/tests/${testId}/attempts`, { method: 'POST', body: JSON.stringify({ answers }) }),
    createModule: (courseId: string, input: { title: string; position?: number }) => request<{ data: unknown }>(`/learning/courses/${courseId}/modules`, { method: 'POST', body: JSON.stringify(input) }),
    createLesson: (moduleId: string, input: Record<string, unknown>) => request<{ data: unknown }>(`/learning/modules/${moduleId}/lessons`, { method: 'POST', body: JSON.stringify(input) }),
    updateLesson: (lessonId: string, input: Record<string, unknown>) => request<{ data: unknown }>(`/learning/lessons/${lessonId}`, { method: 'PATCH', body: JSON.stringify(input) }),
    createLessonNote: (lessonId: string, input: { title?: string; body: string }) => request<{ data: unknown }>(`/learning/lessons/${lessonId}/notes`, { method: 'POST', body: JSON.stringify(input) }),
    createLessonExample: (lessonId: string, input: { title?: string; body: string }) => request<{ data: unknown }>(`/learning/lessons/${lessonId}/examples`, { method: 'POST', body: JSON.stringify(input) }),
    createExercise: (lessonId: string, input: { prompt: string; answer?: string }) => request<{ data: unknown }>(`/learning/lessons/${lessonId}/exercises`, { method: 'POST', body: JSON.stringify(input) }),
    createQuiz: (courseId: string, input: { title: string; lessonId?: string }) => request<{ data: unknown }>(`/learning/courses/${courseId}/quizzes`, { method: 'POST', body: JSON.stringify(input) }),
    createQuizQuestion: (quizId: string, input: Record<string, unknown>) => request<{ data: unknown }>(`/learning/quizzes/${quizId}/questions`, { method: 'POST', body: JSON.stringify(input) }),
    submitLibraryQuiz: (quizId: string, answers: Record<string, string>) => request<{ data: unknown }>(`/learning/quizzes/${quizId}/attempts`, { method: 'POST', body: JSON.stringify({ answers }) }),
    publishCourse: (courseId: string, status: 'draft' | 'pending' | 'published' | 'archived') => request<{ data: unknown }>(`/learning/courses/${courseId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    teacherDashboard: () => request<{ data: unknown }>('/teacher/dashboard'),
    teacherProfile: () => request<{ data: { full_name: string; email: string; bio: string; teacher_verification_status: string; subjects: string; courses: number } | null }>('/teacher/profile'),
    teacherContent: (type: string) => request<{ data: Array<Record<string, unknown>> }>(`/teacher/content/${type}`),
    createTeacherContent: (type: string, input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>(`/teacher/content/${type}`, { method: 'POST', body: JSON.stringify(input) }),
    setTeacherContentStatus: (type: string, id: string, status: string) => request<{ data: Record<string, unknown> }>(`/teacher/content/${type}/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    teacherCourses: () => request<{ data: Array<{ id: string; title: string; description: string; difficulty: string; status: string; subject_id: string; subject: string; students: number }> }>('/teacher/courses'),
    teacherSubjects: () => request<{ data: Array<{ id: string; name: string; description: string }> }>('/learning/subjects'),
    createTeacherCourse: (input: Record<string, unknown>) => request<{ data: unknown }>('/teacher/courses', { method: 'POST', body: JSON.stringify(input) }),
    createTeacherHomework: (input: Record<string, unknown>) => request<{ data: unknown }>('/teacher/homework', { method: 'POST', body: JSON.stringify(input) }),
    teacherHomework: () => request<{ data: unknown[] }>('/teacher/homework'),
    createTeacherQuiz: (input: Record<string, unknown>) => request<{ data: { id: string } }>('/teacher/quizzes', { method: 'POST', body: JSON.stringify(input) }),
    addTeacherQuizQuestion: (id: string, input: Record<string, unknown>) => request<{ data: unknown }>(`/teacher/quizzes/${id}/questions`, { method: 'POST', body: JSON.stringify(input) }),
    createTeacherTest: (input: Record<string, unknown>) => request<{ data: { id: string } }>('/teacher/tests', { method: 'POST', body: JSON.stringify(input) }),
    addTeacherTestQuestion: (id: string, input: Record<string, unknown>) => request<{ data: unknown }>(`/teacher/tests/${id}/questions`, { method: 'POST', body: JSON.stringify(input) }),
    createTeacherExam: (input: Record<string, unknown>) => request<{ data: { id: string } }>('/teacher/exams', { method: 'POST', body: JSON.stringify(input) }),
    addTeacherExamQuestion: (id: string, input: Record<string, unknown>) => request<{ data: unknown }>(`/teacher/exams/${id}/questions`, { method: 'POST', body: JSON.stringify(input) }),
    teacherSubmissions: () => request<{ data: unknown[] }>('/teacher/submissions'),
    gradeTeacherSubmission: (id: string, input: { score: number; feedback: string }) => request<{ data: unknown }>(`/teacher/submissions/${id}/grade`, { method: 'PATCH', body: JSON.stringify(input) }),
    teacherResults: () => request<{ data: unknown[] }>('/teacher/results'),
    teacherAnalytics: () => request<{ data: unknown }>('/teacher/analytics'),
    teacherNotifications: () => request<{ data: unknown[] }>('/teacher/notifications'),
    teacherAiDrafts: () => request<{ data: Array<{ id: string; kind: string; title: string; content: { markdown: string }; status: string }> }>('/teacher/ai/drafts'),
    updateTeacherAiDraft: (id: string, input: { title: string; markdown: string }) => request<{ data: unknown }>(`/teacher/ai/drafts/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    publishTeacherAiDraft: (id: string) => request<{ data: unknown }>(`/teacher/ai/drafts/${id}/publish`, { method: 'POST' }),
    createLibrarySubject: (input: Record<string, unknown>) => request<{ data: unknown }>('/learning/admin/subjects', { method: 'POST', body: JSON.stringify(input) }),
    createEducationLevel: (input: Record<string, unknown>) => request<{ data: unknown }>('/learning/admin/levels', { method: 'POST', body: JSON.stringify(input) }),
    createGrade: (input: Record<string, unknown>) => request<{ data: unknown }>('/learning/admin/grades', { method: 'POST', body: JSON.stringify(input) }),
    createFaculty: (input: Record<string, unknown>) => request<{ data: unknown }>('/learning/admin/faculties', { method: 'POST', body: JSON.stringify(input) }),
    createDepartment: (input: Record<string, unknown>) => request<{ data: unknown }>('/learning/admin/departments', { method: 'POST', body: JSON.stringify(input) }),
    createProgram: (input: Record<string, unknown>) => request<{ data: unknown }>('/learning/admin/programs', { method: 'POST', body: JSON.stringify(input) }),
    adminOverview: () => request<{ data: Record<string, unknown> }>('/admin/overview'),
    adminClassDashboards: () => request<{ data: Array<{ full_name: string; email: string; class_code: string; updated_at: string; tasks_completed: number; tasks_total: number; quizzes_taken: number; average_score: number | null }> }>('/admin/class-dashboards'),
    adminTaxonomy: () => request<{ data: { levels: Record<string, unknown>[]; grades: Record<string, unknown>[]; programs: Record<string, unknown>[]; subjects: Record<string, unknown>[] } }>('/admin/taxonomy'),
    adminCurriculumRegistry: () => request<{ data: { sources: Record<string, unknown>[]; versions: Record<string, unknown>[]; combinations: Record<string, unknown>[]; subjects: Record<string, unknown>[]; programs: Record<string, unknown>[]; curriculumUnits: Record<string, unknown>[]; curriculumOutcomes: Record<string, unknown>[]; tvetSubjects: Record<string, unknown>[]; tvetCompetences: Record<string, unknown>[]; tvetModules: Record<string, unknown>[]; tvetUnits: Record<string, unknown>[]; tvetOutcomes: Record<string, unknown>[] } }>('/admin/curriculum-registry'),
    adminLearningMaterials: (search = '') => request<{ data: Array<Record<string, unknown>> }>(`/admin/learning-materials${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    adminMaterialOptions: () => request<{ data: { curriculumUnits: Array<Record<string, unknown>>; tvetUnits: Array<Record<string, unknown>>; courseLessons: Array<Record<string, unknown>>; tvetLessons: Array<Record<string, unknown>> } }>('/admin/learning-material-options'),
    createAdminLearningMaterial: (input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>('/admin/learning-materials', { method: 'POST', body: JSON.stringify(input) }),
    uploadAdminLearningMaterial: uploadLearningMaterial,
    replaceAdminLearningMaterialFile: replaceLearningMaterialFile,
    updateAdminLearningMaterial: (id: string, input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>(`/admin/learning-materials/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
    setLearningMaterialStatus: (id: string, status: 'draft' | 'published' | 'retired') => request<{ data: Record<string, unknown> }>(`/admin/learning-materials/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    retryLearningMaterial: (id: string) => request<{ data: Record<string, unknown> }>(`/admin/learning-materials/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
    deleteLearningMaterial: (id: string) => request<void>(`/admin/learning-materials/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    adminLearningMaterialFile: (id: string) => privateLearningMaterialFile(`/admin/learning-materials/${encodeURIComponent(id)}/file`),
    studentLearningMaterialFile: (id: string) => privateLearningMaterialFile(`/student/materials/${encodeURIComponent(id)}/file`),
    setCurriculumSourceVerification: (id: string, verificationStatus: string) => request<{ data: Record<string, unknown> }>(`/admin/curriculum-sources/${encodeURIComponent(id)}/verification`, { method: 'PATCH', body: JSON.stringify({ verificationStatus }) }),
    setCurriculumVersionStatus: (id: string, status: string) => request<{ data: Record<string, unknown> }>(`/admin/curriculum-versions/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    setProgramCurriculumVerification: (id: string, input: { verificationStatus: string; sourceReference?: string }) => request<{ data: Record<string, unknown> }>(`/admin/programs/${encodeURIComponent(id)}/curriculum-verification`, { method: 'PATCH', body: JSON.stringify(input) }),
    createCurriculumCombination: (input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>('/admin/curriculum-combinations', { method: 'POST', body: JSON.stringify(input) }),
    createCurriculumSubject: (input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>('/admin/curriculum-subjects', { method: 'POST', body: JSON.stringify(input) }),
    createCurriculumUnit: (input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>('/admin/curriculum-units', { method: 'POST', body: JSON.stringify(input) }),
    createCurriculumOutcome: (id: string, input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>(`/admin/curriculum-units/${encodeURIComponent(id)}/outcomes`, { method: 'POST', body: JSON.stringify(input) }),
    setCurriculumRecordStatus: (type: string, id: string, status: string) => request<{ data: Record<string, unknown> }>(`/admin/curriculum-records/${encodeURIComponent(type)}/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    enrollCurriculumSubject: (input: { studentId: string; curriculumSubjectId: string }) => request<{ data: Record<string, unknown> }>('/admin/curriculum-enrollments', { method: 'POST', body: JSON.stringify(input) }),
    updateStudentSubjectCombination: (id: string, combinationId: string | null) => request<{ data: Record<string, unknown> }>(`/admin/students/${encodeURIComponent(id)}/subject-combination`, { method: 'PATCH', body: JSON.stringify({ combinationId }) }),
    createCurriculumMaterial: (input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>('/admin/curriculum-materials', { method: 'POST', body: JSON.stringify(input) }),
    createTvetSubject: (input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>('/admin/tvet-subjects', { method: 'POST', body: JSON.stringify(input) }),
    createTvetCompetence: (id: string, input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>(`/admin/tvet-subjects/${encodeURIComponent(id)}/competences`, { method: 'POST', body: JSON.stringify(input) }),
    createTvetModule: (id: string, input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>(`/admin/tvet-competences/${encodeURIComponent(id)}/modules`, { method: 'POST', body: JSON.stringify(input) }),
    createTvetUnit: (id: string, input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>(`/admin/tvet-modules/${encodeURIComponent(id)}/units`, { method: 'POST', body: JSON.stringify(input) }),
    createTvetOutcome: (id: string, input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>(`/admin/tvet-units/${encodeURIComponent(id)}/outcomes`, { method: 'POST', body: JSON.stringify(input) }),
    setTvetCurriculumStatus: (type: string, id: string, status: string) => request<{ data: Record<string, unknown> }>(`/admin/tvet-curriculum/${encodeURIComponent(type)}/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    adminSchools: (filters?: { search?: string; limit?: number; offset?: number }) => { const params = new URLSearchParams(); for (const [key, value] of Object.entries(filters || {})) if (value !== undefined && value !== '') params.set(key, String(value)); return request<{ data: Record<string, unknown>[]; meta?: { total: number; limit: number; offset: number } }>(`/admin/schools${params.size ? `?${params.toString()}` : ''}`) },
    createAdminSchool: (input: { name: string; location?: string; phone?: string; email: string; status?: string }) => request<{ data: Record<string, unknown> }>('/admin/schools', { method: 'POST', body: JSON.stringify(input) }),
    updateAdminSchool: (id: string, input: { status?: string }) => request<{ data: Record<string, unknown> }>(`/admin/schools/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
    adminSubjectNotes: (filters?: { search?: string; limit?: number; offset?: number }) => { const params = new URLSearchParams(); for (const [key, value] of Object.entries(filters || {})) if (value !== undefined && value !== '') params.set(key, String(value)); return request<{ data: Record<string, unknown>[]; meta: { total: number; limit: number; offset: number } }>(`/admin/subject-notes${params.size ? `?${params.toString()}` : ''}`) },
    createAdminSubjectNote: (input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>('/admin/subject-notes', { method: 'POST', body: JSON.stringify(input) }),
    updateAdminSubjectNote: (id: string, input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>(`/admin/subject-notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
    setAdminSubjectNoteStatus: (id: string, status: string) => request<{ data: Record<string, unknown> }>(`/admin/subject-notes/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    deleteAdminSubjectNote: (id: string) => request<void>(`/admin/subject-notes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    deleteStagedSubjectNoteFile: (id: string) => request<void>(`/admin/subject-note-attachments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    adminReview: () => request<{ data: Record<string, unknown>[] }>('/admin/review'),
    adminUsers: (filters?: { search?: string; role?: string; status?: string; limit?: number; offset?: number }) => { const params = new URLSearchParams(); for (const [key, value] of Object.entries(filters || {})) if (value !== undefined && value !== '') params.set(key, String(value)); return request<{ data: Record<string, unknown>[]; meta: { total: number; limit: number; offset: number } }>(`/admin/users${params.size ? `?${params.toString()}` : ''}`) },
    adminEnrollmentOptions: () => request<{ data: { users: Record<string, unknown>[]; schools: Record<string, unknown>[]; levels: Record<string, unknown>[]; grades: Record<string, unknown>[]; programs: Record<string, unknown>[]; subjects: Record<string, unknown>[] } }>('/admin/enrollment-options'),
    setStudentEnrollment: (userId: string, input: { schoolId: string; educationLevelId: string; gradeId: string; programId?: string | null; subjectCombinationId?: string | null }) => request<{ data: Record<string, unknown> }>(`/admin/users/${encodeURIComponent(userId)}/enrollment`, { method: 'PUT', body: JSON.stringify(input) }),
    setTeacherSchool: (teacherId: string, schoolId: string) => request<{ data: Record<string, unknown> }>(`/admin/teachers/${encodeURIComponent(teacherId)}/school`, { method: 'PUT', body: JSON.stringify({ schoolId }) }),
    teacherAssignments: (teacherId: string) => request<{ data: Record<string, unknown>[] }>(`/admin/teachers/${encodeURIComponent(teacherId)}/teaching-assignments`),
    createTeacherAssignment: (teacherId: string, input: { schoolId: string; gradeId: string; programId?: string | null; subjectId: string }) => request<{ data: Record<string, unknown> }>(`/admin/teachers/${encodeURIComponent(teacherId)}/teaching-assignments`, { method: 'POST', body: JSON.stringify(input) }),
    deleteTeacherAssignment: (teacherId: string, assignmentId: string) => request<void>(`/admin/teachers/${encodeURIComponent(teacherId)}/teaching-assignments/${encodeURIComponent(assignmentId)}`, { method: 'DELETE' }),
    updateAdminUserStatus: (id: string, status: 'active' | 'suspended' | 'pending') => request<{ data: Record<string, unknown> }>(`/admin/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    adminTeachers: () => request<{ data: Record<string, unknown>[] }>('/admin/teachers'),
    adminContent: (type: string, filters?: { search?: string; level?: string; grade?: string; program?: string; subject?: string; limit?: number; offset?: number }) => { const params = new URLSearchParams(); for (const [key, value] of Object.entries(filters || {})) if (value !== undefined && value !== '') params.set(key, String(value)); return request<{ data: Record<string, unknown>[]; meta?: { total: number; limit: number; offset: number } }>(`/admin/content/${type}${params.size ? `?${params.toString()}` : ''}`) },
    createAdminContent: (type: string, input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>(`/admin/content/${type}`, { method: 'POST', body: JSON.stringify(input) }),
    updateAdminContent: (type: string, id: string, input: Record<string, unknown>) => request<{ data: Record<string, unknown> }>(`/admin/content/${type}/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    setAdminContentStatus: (type: string, id: string, status: string) => request<{ data: Record<string, unknown> }>(`/admin/content/${type}/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    deleteAdminContent: (type: string, id: string) => request<void>(`/admin/content/${type}/${id}`, { method: 'DELETE' }),
    verifyTeacher: (id: string, status: string) => request<{ data: Record<string, unknown> }>(`/admin/teachers/${id}/verification`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    createAdminTeacher: (input: { email: string; fullName: string; bio?: string }) => request<{ data: Record<string, unknown> }>('/admin/teachers', { method: 'POST', body: JSON.stringify(input) }),
    updateTeacherStatus: (id: string, status: string) => request<{ data: Record<string, unknown> }>(`/admin/teachers/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    resendTeacherVerification: (id: string) => request<{ message: string }>(`/admin/teachers/${id}/resend-verification`, { method: 'POST' }),
    setTeacherPermissions: (id: string, permissions: string[]) => request<{ data: Record<string, unknown> }>(`/admin/teachers/${id}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions }) }),
    requestTeacherCode: (email: string) => request<{ message: string }>('/auth/teacher/request-code', { method: 'POST', body: JSON.stringify({ email }) }),
    verifyTeacherCode: (email: string, code: string) => request<BackendSession>('/auth/teacher/verify-code', { method: 'POST', body: JSON.stringify({ email, code }) }).then((response) => { const token = response.accessToken || response.token; if (!token) throw new Error('The server returned an invalid teacher sign-in response.'); const session: ApiSession = { accessToken: token, user: { id: response.user.id, email: response.user.email, fullName: response.user.fullName || response.user.name || response.user.email.split('@')[0], role: 'teacher' } }; setAccessToken(session.accessToken); setStoredUser(session.user); return session }),
    adminAuditLogs: () => request<{ data: Record<string, unknown>[] }>('/admin/audit-logs'),
}
