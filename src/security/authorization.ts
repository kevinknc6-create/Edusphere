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

export function can(role: AppRole, permission: Permission) {
    return rolePermissions[role].includes(permission)
}

export function canAccessAdmin(role: AppRole) {
    return role === 'admin' || role === 'super-admin'
}

export function canManageAuditLogs(role: AppRole) {
    return can(role, 'audit.view')
}
