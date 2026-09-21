export type AppRole = 'student' | 'teacher' | 'admin' | 'super-admin'

export type Permission =
    | 'users.view'
    | 'users.manage'
    | 'subjects.manage'
    | 'courses.moderate'
    | 'system.manage'
    | 'audit.view'

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
