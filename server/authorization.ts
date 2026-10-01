export type AppRole = 'student' | 'teacher' | 'admin' | 'super-admin'

export type Permission =
    | 'users.view'
    | 'users.manage'
    | 'subjects.manage'
    | 'courses.moderate'
    | 'system.manage'
    | 'audit.view'
    | 'courses.create'
    | 'courses.update'
    | 'courses.delete'
    | 'courses.publish'
    | 'lessons.create'
    | 'lessons.update'
    | 'lessons.delete'
    | 'quizzes.create'
    | 'quizzes.update'
    | 'tests.create'
    | 'tests.update'
    | 'exams.create'
    | 'exams.update'
    | 'homework.create'
    | 'homework.update'
    | 'students.view'
    | 'results.view'

const rolePermissions: Record<AppRole, readonly Permission[]> = {
    student: [],
    teacher: [],
    admin: ['users.view', 'users.manage', 'subjects.manage', 'courses.moderate', 'system.manage'],
    'super-admin': ['users.view', 'users.manage', 'subjects.manage', 'courses.moderate', 'system.manage', 'audit.view'],
}

export function authorize(role: AppRole, permission: Permission) {
    if (!rolePermissions[role]?.includes(permission)) {
        throw new Error('Forbidden')
    }
    return true
}

export function isAdmin(role: AppRole) {
    return role === 'admin' || role === 'super-admin'
}
