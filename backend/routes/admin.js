const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const pool = require("../db");
const {
    extractReadableContent, fetchPublicResource, queueMaterialProcessing,
    storagePath, storePdf,
} = require("../services/learningMaterials");

const router = express.Router();
const contentTypes = new Set(["levels", "grades", "programs", "subjects", "courses", "modules", "lessons", "notes", "examples", "exercises", "assignments", "quizzes", "tests", "exams"]);
const materialUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
        if (file.mimetype !== "application/pdf") {
            const error = httpError(415, "Upload a PDF document only.");
            return callback(error);
        }
        return callback(null, true);
    },
});
function parseLearningMaterialInput(body) {
    const input = {
        schoolId: positiveInteger(body.schoolId, "School"),
        curriculumVersionId: optionalInteger(body.curriculumVersionId),
        educationLevelId: positiveInteger(body.educationLevelId, "Education level"),
        gradeId: optionalInteger(body.gradeId),
        programId: optionalInteger(body.programId),
        subjectId: optionalInteger(body.subjectId),
        tvetSubjectId: optionalInteger(body.tvetSubjectId),
        curriculumUnitId: optionalInteger(body.curriculumUnitId),
        tvetUnitId: optionalInteger(body.tvetUnitId),
        courseLessonId: optionalInteger(body.courseLessonId),
        tvetLessonId: optionalInteger(body.tvetLessonId),
        materialType: text(body.materialType || "other", "Material type", true, 30),
        title: text(body.title, "Material title", true, 240),
        description: text(body.description, "Description", false, 4000),
        publisher: text(body.publisher, "Publisher", false, 200),
        edition: text(body.edition, "Edition", false, 120),
        sourceReference: text(body.sourceReference, "Source reference", false, 2000),
        rightsConfirmed: body.rightsConfirmed === true || body.rightsConfirmed === "true",
    };
    const idFields = ["gradeId", "programId", "subjectId", "tvetSubjectId", "curriculumUnitId", "tvetUnitId", "courseLessonId", "tvetLessonId"];
    const invalid = idFields.find((key) => input[key] && input[key].error);
    if (invalid) throw httpError(400, input[invalid].error);
    if (!["textbook", "teacher_guide", "worksheet", "digital", "other", "notes", "module", "learning_guide"].includes(input.materialType)) {
        throw httpError(400, "Choose a valid learning material type.");
    }
    if (input.subjectId && input.tvetSubjectId) throw httpError(400, "Choose either a curriculum subject or a TVET subject.");
    if (!input.rightsConfirmed) throw httpError(400, "Confirm that your school or organization has the right to upload, process, and share this material.");
    if (input.curriculumUnitId && input.tvetUnitId) throw httpError(400, "Choose either a curriculum unit or a TVET unit.");
    if (input.courseLessonId && input.tvetLessonId) throw httpError(400, "Choose either a course lesson or a TVET lesson.");
    if (input.curriculumUnitId && !input.subjectId) throw httpError(400, "Select a curriculum subject before assigning a unit.");
    if ((input.tvetUnitId || input.tvetLessonId || input.tvetSubjectId) && !input.tvetSubjectId) throw httpError(400, "Select a TVET subject for the selected program unit or lesson.");
    return input;
}

async function validateLearningMaterialScope(input) {
    const version = await pool.query(`SELECT COALESCE($1::bigint,
        (SELECT s.curriculum_version_id FROM curriculum_subjects s WHERE s.id = $2),
        (SELECT s.curriculum_version_id FROM tvet_subjects s WHERE s.id = $3)) AS curriculum_version_id`, [
        input.curriculumVersionId, input.subjectId, input.tvetSubjectId,
    ]);
    input.curriculumVersionId = version.rows[0].curriculum_version_id;
    const valid = await pool.query(`SELECT
        EXISTS(SELECT 1 FROM admin_schools WHERE id = $1 AND status = 'active')
        AND EXISTS(SELECT 1 FROM education_levels WHERE id = $2)
        AND ($3::bigint IS NULL OR EXISTS(SELECT 1 FROM grades WHERE id = $3 AND education_level_id = $2))
        AND ($4::bigint IS NULL OR EXISTS(SELECT 1 FROM programs WHERE id = $4))
        AND ($5::bigint IS NULL OR EXISTS(SELECT 1 FROM curriculum_versions v
            JOIN curriculum_sources src ON src.id = v.source_id
            WHERE v.id = $5 AND v.status = 'active' AND src.verification_status = 'verified'))
        AND ($6::bigint IS NULL OR EXISTS(SELECT 1 FROM curriculum_subjects s
            JOIN curriculum_versions v ON v.id = s.curriculum_version_id AND v.status = 'active'
            JOIN curriculum_sources src ON src.id = v.source_id AND src.verification_status = 'verified'
            WHERE s.id = $6 AND ($5::bigint IS NULL OR s.curriculum_version_id = $5) AND s.education_level_id = $2
                AND (s.grade_id IS NULL OR s.grade_id IS NOT DISTINCT FROM $3::bigint)
                AND (s.program_id IS NULL OR s.program_id IS NOT DISTINCT FROM $4::bigint)))
        AND ($7::bigint IS NULL OR EXISTS(SELECT 1 FROM tvet_subjects s
            JOIN curriculum_versions v ON v.id = s.curriculum_version_id AND v.status = 'active'
            JOIN curriculum_sources src ON src.id = v.source_id AND src.verification_status = 'verified'
            WHERE s.id = $7 AND ($5::bigint IS NULL OR s.curriculum_version_id = $5) AND s.program_id IS NOT DISTINCT FROM $4::bigint
                AND s.grade_id IS NOT DISTINCT FROM $3::bigint AND s.status = 'published'))
        AND ($8::bigint IS NULL OR EXISTS(SELECT 1 FROM curriculum_units u
            WHERE u.id = $8 AND u.curriculum_subject_id = $6))
        AND ($9::bigint IS NULL OR EXISTS(SELECT 1 FROM tvet_units u
            JOIN tvet_modules m ON m.id = u.module_id JOIN tvet_competences c ON c.id = m.competence_id
            WHERE u.id = $9 AND c.subject_id = $7))
        AND ($10::bigint IS NULL OR EXISTS(SELECT 1 FROM course_lessons l
            JOIN course_modules m ON m.id = l.module_id JOIN library_courses c ON c.id = m.course_id
            WHERE l.id = $10 AND c.education_level_id = $2
            AND c.grade_id IS NOT DISTINCT FROM $3::bigint AND c.program_id IS NOT DISTINCT FROM $4::bigint
            AND ($6::bigint IS NULL OR EXISTS (SELECT 1 FROM curriculum_subject_library_subjects mapping
                WHERE mapping.curriculum_subject_id = $6 AND mapping.library_subject_id = c.subject_id))))
        AND ($11::bigint IS NULL OR EXISTS(SELECT 1 FROM tvet_lessons l
            JOIN tvet_units u ON u.id = l.unit_id JOIN tvet_modules m ON m.id = u.module_id
            JOIN tvet_competences c ON c.id = m.competence_id
            WHERE l.id = $11 AND c.subject_id = $7)) AS valid,
        COALESCE($5::bigint,
            (SELECT s.curriculum_version_id FROM curriculum_subjects s WHERE s.id = $6),
            (SELECT s.curriculum_version_id FROM tvet_subjects s WHERE s.id = $7)) AS curriculum_version_id`, [
        input.schoolId, input.educationLevelId, input.gradeId, input.programId, input.curriculumVersionId,
        input.subjectId, input.tvetSubjectId, input.curriculumUnitId, input.tvetUnitId, input.courseLessonId, input.tvetLessonId,
    ]);
    if (!valid.rows[0].valid) throw httpError(400, "The school, class, program, or subject does not match the selected assignment.");
    input.curriculumVersionId = valid.rows[0].curriculum_version_id;
}

async function insertLearningMaterial(input, userId, source) {
    await validateLearningMaterialScope(input);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const created = await client.query(`INSERT INTO curriculum_materials
            (curriculum_version_id, education_level_id, grade_id, program_id, subject_id, material_type,
             title, publisher, edition, url, source_reference, status, description, source_type, storage_key,
             original_filename, content_type, size_bytes, processing_status, tvet_subject_id, curriculum_unit_id,
             tvet_unit_id, course_lesson_id, tvet_lesson_id, created_by, rights_confirmed_by, rights_confirmed_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft', $12, $13, $14, $15, $16, $17,
                    'pending', $18, $19, $20, $21, $22, $23, $24, now())
            RETURNING id, title, description, material_type, source_type, status, processing_status, created_at`, [
            input.curriculumVersionId, input.educationLevelId, input.gradeId, input.programId, input.subjectId,
            input.materialType, input.title, input.publisher, input.edition, source.url || "", input.sourceReference,
            input.description, source.type, source.storageKey || null, source.filename || "", source.contentType || "",
            source.size || null, input.tvetSubjectId, input.curriculumUnitId, input.tvetUnitId,
            input.courseLessonId, input.tvetLessonId, userId, userId,
        ]);
        await client.query("INSERT INTO school_textbook_assignments (school_id, material_id, assigned_by) VALUES ($1, $2, $3)", [input.schoolId, created.rows[0].id, userId]);
        await client.query("INSERT INTO admin_audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)", [
            userId, "learning_material.created", "curriculum_material", String(created.rows[0].id),
            JSON.stringify({ schoolId: input.schoolId, sourceType: source.type, processingStatus: "pending" }),
        ]);
        await client.query("COMMIT");
        return created.rows[0];
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function positiveInteger(value, label) { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw httpError(400, `${label} must be a positive integer.`); return parsed; }
function optionalInteger(value) { if (value === null || value === undefined || value === "") return null; return positiveInteger(value, "ID"); }
function text(value, label, required = false, max = 4000) {
    const result = typeof value === "string" ? value.trim() : "";
    if (required && !result) throw httpError(400, `${label} is required.`);
    if (result.length > max) throw httpError(400, `${label} is too long.`);
    return result;
}
function attachmentIdsFrom(body) {
    const ids = body.attachmentIds === undefined ? [] : body.attachmentIds;
    if (!Array.isArray(ids) || ids.length > 10) throw httpError(400, "Choose no more than 10 supported attachments.");
    return ids.map((id) => positiveInteger(id, "Attachment"));
}
async function saveSubjectNoteAttachments(client, noteId, userId, attachmentIds) {
    const existing = attachmentIds.length
        ? await client.query("SELECT id FROM subject_note_attachments WHERE id = ANY($1::bigint[]) AND (created_by = $2 OR note_id = $3) FOR UPDATE", [attachmentIds, userId, noteId])
        : { rows: [] };
    if (existing.rows.length !== attachmentIds.length) throw httpError(400, "One or more selected attachments are invalid.");
    if (attachmentIds.length) {
        await client.query("DELETE FROM subject_note_attachments WHERE note_id = $1 AND NOT (id = ANY($2::bigint[]))", [noteId, attachmentIds]);
        await client.query("UPDATE subject_note_attachments SET note_id = $1 WHERE id = ANY($2::bigint[]) AND created_by = $3 AND note_id IS NULL", [noteId, attachmentIds, userId]);
    } else {
        await client.query("DELETE FROM subject_note_attachments WHERE note_id = $1", [noteId]);
    }
}
function statusValue(value, fallback = "draft") {
    const result = value || fallback;
    if (!["draft", "pending", "published", "rejected", "archived"].includes(result)) throw httpError(400, "Invalid content status.");
    return result;
}

function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return res.status(401).json({ message: "Authentication required" });
    try {
        const claims = jwt.verify(header.slice(7), process.env.JWT_SECRET);
        req.auth = { userId: claims.id || claims.sub, role: claims.role || "student" };
        next();
    } catch {
        res.status(401).json({ message: "Your session has expired" });
    }
}

async function requireAdmin(req, res, next) {
    try {
        const result = await pool.query("SELECT role, status FROM users WHERE id = $1", [req.auth.userId]);
        const user = result.rows[0];
        if (!user || user.status !== "active") return res.status(401).json({ message: "Active administrator session required" });
        if (!["admin", "super-admin"].includes(user.role)) return res.status(403).json({ message: "Admin access required" });
        req.auth.role = user.role;
        next();
    } catch (error) {
        console.error("ADMIN AUTH ERROR:", error);
        res.status(500).json({ message: "Administrator access could not be verified" });
    }
}

router.use(requireAuth, requireAdmin);

async function audit(req, action, type, id, metadata = {}) {
    await pool.query("INSERT INTO admin_audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)", [req.auth.userId, action, type, id === null ? null : String(id), JSON.stringify(metadata)]);
}

router.get("/enrollment-options", async (_req, res) => {
    try {
        const [users, schools, levels, grades, programs, subjects] = await Promise.all([
            pool.query("SELECT id, name AS full_name, email, role, status, school_id, education_level_id, grade_id, program_id FROM users WHERE role IN ('student','teacher') AND status <> 'suspended' ORDER BY name LIMIT 1000"),
            pool.query("SELECT id, name, status FROM admin_schools ORDER BY name"),
            pool.query("SELECT id, name, code, category FROM education_levels ORDER BY position, name"),
            pool.query("SELECT id, education_level_id, name, code FROM grades ORDER BY education_level_id, position, name"),
            pool.query("SELECT id, name FROM programs ORDER BY name"),
            pool.query("SELECT id, name, education_level_id, grade_id, program_id FROM library_subjects ORDER BY name"),
        ]);
        return res.json({ data: { users: users.rows, schools: schools.rows, levels: levels.rows, grades: grades.rows, programs: programs.rows, subjects: subjects.rows } });
    } catch (error) {
        console.error("ENROLLMENT OPTIONS ERROR:", error.message);
        return res.status(500).json({ message: "Enrollment options could not be loaded." });
    }
});

router.put("/users/:id/enrollment", async (req, res) => {
    const userId = positiveInteger(req.params.id, "User");
    const schoolId = optionalInteger(req.body.schoolId);
    const educationLevelId = positiveInteger(req.body.educationLevelId, "Education level");
    const gradeId = positiveInteger(req.body.gradeId, "Class");
    const programId = optionalInteger(req.body.programId);
    const combinationId = optionalInteger(req.body.subjectCombinationId);
    const invalid = [schoolId, programId, combinationId].find((item) => item && item.error);
    if (invalid) return res.status(400).json({ message: invalid.error });
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const student = await client.query("SELECT id, school_id, education_level_id, grade_id, program_id FROM users WHERE id = $1 AND role = 'student' AND status <> 'suspended' FOR UPDATE", [userId]);
        if (!student.rows[0]) throw httpError(404, "Active student not found.");
        const [school, grade, program, combination] = await Promise.all([
            client.query("SELECT id FROM admin_schools WHERE id = $1 AND status = 'active'", [schoolId]),
            client.query("SELECT id FROM grades WHERE id = $1 AND education_level_id = $2", [gradeId, educationLevelId]),
            programId ? client.query(`SELECT p.id FROM programs p WHERE p.id = $1
                AND (NOT EXISTS (SELECT 1 FROM tvet_program_levels WHERE program_id = p.id)
                    OR EXISTS (SELECT 1 FROM tvet_program_levels WHERE program_id = p.id AND grade_id = $2))`, [programId, gradeId]) : Promise.resolve({ rows: [{}] }),
            combinationId ? client.query("SELECT id FROM curriculum_combinations WHERE id = $1 AND education_level_id = $2", [combinationId, educationLevelId]) : Promise.resolve({ rows: [{}] }),
        ]);
        if (!school.rows[0]) throw httpError(400, "Choose an active school.");
        if (!grade.rows[0]) throw httpError(400, "The selected class does not belong to the education level.");
        if (!program.rows[0]) throw httpError(400, "The selected program is not available for this class.");
        if (!combination.rows[0]) throw httpError(400, "The selected subject combination is not available for this education level.");
        const result = await client.query(`UPDATE users SET school_id = $1, education_level_id = $2, grade_id = $3,
                program_id = $4, subject_combination_id = $5
            WHERE id = $6 AND role = 'student'
            RETURNING id, school_id, education_level_id, grade_id, program_id, subject_combination_id`,
        [schoolId, educationLevelId, gradeId, programId, combinationId, userId]);
        const previous = student.rows[0];
        if (String(previous.school_id || "") !== String(schoolId)
            || String(previous.grade_id || "") !== String(gradeId)
            || String(previous.program_id || "") !== String(programId || "")) {
            await client.query("UPDATE student_curriculum_enrollments SET status = 'ended' WHERE student_id = $1 AND status = 'active'", [userId]);
        }
        await client.query("COMMIT");
        await audit(req, "student.enrollment_changed", "student", userId, {
            schoolId, educationLevelId, gradeId, programId, subjectCombinationId: combinationId,
            transferred: String(previous.school_id || "") !== String(schoolId),
        });
        return res.json({ data: result.rows[0] });
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error("STUDENT ENROLLMENT UPDATE ERROR:", error.message);
        return res.status(500).json({ message: "Student school and class assignment could not be saved." });
    } finally {
        client.release();
    }
});

router.put("/teachers/:id/school", async (req, res) => {
    const teacherId = positiveInteger(req.params.id, "Teacher");
    const schoolId = positiveInteger(req.body.schoolId, "School");
    try {
        const result = await pool.query(`UPDATE users SET school_id = $1
            WHERE id = $2 AND role = 'teacher' AND status <> 'suspended'
                AND EXISTS (SELECT 1 FROM admin_schools WHERE id = $1 AND status = 'active')
            RETURNING id, school_id`, [schoolId, teacherId]);
        if (!result.rows[0]) return res.status(400).json({ message: "An active teacher and active school are required." });
        await audit(req, "teacher.school_assigned", "teacher", teacherId, { schoolId });
        return res.json({ data: result.rows[0] });
    } catch (error) {
        console.error("TEACHER SCHOOL ASSIGNMENT ERROR:", error.message);
        return res.status(500).json({ message: "Teacher school assignment could not be saved." });
    }
});

router.get("/teachers/:id/teaching-assignments", async (req, res) => {
    const teacherId = positiveInteger(req.params.id, "Teacher");
    try {
        const result = await pool.query(`SELECT assignment.id, assignment.school_id, school.name AS school_name,
                assignment.grade_id, grade.name AS grade_name, assignment.program_id, program.name AS program_name,
                assignment.subject_id, subject.name AS subject_name
            FROM teacher_subject_assignments assignment
            JOIN admin_schools school ON school.id = assignment.school_id
            JOIN grades grade ON grade.id = assignment.grade_id
            LEFT JOIN programs program ON program.id = assignment.program_id
            JOIN library_subjects subject ON subject.id = assignment.subject_id
            WHERE assignment.teacher_id = $1 ORDER BY school.name, grade.position, subject.name`, [teacherId]);
        return res.json({ data: result.rows });
    } catch (error) {
        console.error("TEACHER ASSIGNMENTS READ ERROR:", error.message);
        return res.status(500).json({ message: "Teacher assignments could not be loaded." });
    }
});

router.post("/teachers/:id/teaching-assignments", async (req, res) => {
    const teacherId = positiveInteger(req.params.id, "Teacher");
    const schoolId = positiveInteger(req.body.schoolId, "School");
    const gradeId = positiveInteger(req.body.gradeId, "Class");
    const programId = optionalInteger(req.body.programId);
    const subjectId = positiveInteger(req.body.subjectId, "Subject");
    if (programId && programId.error) return res.status(400).json({ message: programId.error });
    try {
        const valid = await pool.query(`SELECT teacher.id
            FROM users teacher
            JOIN admin_schools school ON school.id = $2 AND school.status = 'active'
            JOIN grades grade ON grade.id = $3
            JOIN education_levels level ON level.id = grade.education_level_id
            JOIN library_subjects subject ON subject.id = $5
            WHERE teacher.id = $1 AND teacher.role = 'teacher' AND teacher.status = 'active'
                AND teacher.school_id = school.id
                AND ($4::bigint IS NULL OR EXISTS (SELECT 1 FROM programs p WHERE p.id = $4
                    AND (NOT EXISTS (SELECT 1 FROM tvet_program_levels WHERE program_id = p.id)
                        OR EXISTS (SELECT 1 FROM tvet_program_levels WHERE program_id = p.id AND grade_id = grade.id))))
                AND (subject.education_level_id IS NULL OR subject.education_level_id = level.id)
                AND (subject.grade_id IS NULL OR subject.grade_id = grade.id)
                AND (subject.program_id IS NULL OR subject.program_id IS NOT DISTINCT FROM $4::bigint)`,
        [teacherId, schoolId, gradeId, programId, subjectId]);
        if (!valid.rows[0]) return res.status(400).json({ message: "Teacher, school, class, program and subject must form a valid assignment." });
        const result = await pool.query(`INSERT INTO teacher_subject_assignments
            (teacher_id, school_id, grade_id, program_id, subject_id, assigned_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT DO NOTHING
            RETURNING id, teacher_id, school_id, grade_id, program_id, subject_id`,
        [teacherId, schoolId, gradeId, programId, subjectId, req.auth.userId]);
        await audit(req, "teacher.subject_assigned", "teacher", teacherId, { schoolId, gradeId, programId, subjectId });
        return res.status(result.rows[0] ? 201 : 200).json({ data: result.rows[0] || { teacherId, schoolId, gradeId, programId, subjectId } });
    } catch (error) {
        console.error("TEACHER SUBJECT ASSIGNMENT ERROR:", error.message);
        return res.status(500).json({ message: "Teacher subject assignment could not be saved." });
    }
});

router.delete("/teachers/:id/teaching-assignments/:assignmentId", async (req, res) => {
    const teacherId = positiveInteger(req.params.id, "Teacher");
    const assignmentId = positiveInteger(req.params.assignmentId, "Assignment");
    try {
        const result = await pool.query("DELETE FROM teacher_subject_assignments WHERE id = $1 AND teacher_id = $2 RETURNING id", [assignmentId, teacherId]);
        if (!result.rows[0]) return res.status(404).json({ message: "Teacher assignment not found." });
        await audit(req, "teacher.subject_unassigned", "teacher", teacherId, { assignmentId });
        return res.sendStatus(204);
    } catch (error) {
        console.error("TEACHER SUBJECT UNASSIGN ERROR:", error.message);
        return res.status(500).json({ message: "Teacher assignment could not be removed." });
    }
});

async function targetFrom(body, requireSubject = true) {
    const educationLevelId = positiveInteger(body.educationLevelId, "Education level");
    const gradeId = positiveInteger(body.gradeId, "Class/grade");
    const programId = optionalInteger(body.programId);
    const subjectId = requireSubject ? positiveInteger(body.subjectId, "Subject") : optionalInteger(body.subjectId);
    const [level, grade] = await Promise.all([
        pool.query("SELECT id FROM education_levels WHERE id = $1", [educationLevelId]),
        pool.query("SELECT id FROM grades WHERE id = $1 AND education_level_id = $2", [gradeId, educationLevelId]),
    ]);
    if (!level.rows[0] || !grade.rows[0]) throw httpError(400, "Choose a class that belongs to the selected education level.");
    if (programId) {
        const program = await pool.query("SELECT id FROM programs WHERE id = $1", [programId]);
        if (!program.rows[0]) throw httpError(400, "The selected program does not exist.");
        const programGrades = await pool.query("SELECT 1 FROM tvet_program_levels WHERE program_id = $1 LIMIT 1", [programId]);
        if (programGrades.rows[0]) {
            const assignment = await pool.query("SELECT 1 FROM tvet_program_levels WHERE program_id = $1 AND grade_id = $2", [programId, gradeId]);
            if (!assignment.rows[0]) throw httpError(400, "The selected program is not assigned to this class.");
        }
    }
    if (subjectId) {
        const subject = await pool.query("SELECT id FROM library_subjects WHERE id = $1 AND education_level_id = $2 AND grade_id IS NOT DISTINCT FROM $3::bigint AND program_id IS NOT DISTINCT FROM $4::bigint", [subjectId, educationLevelId, gradeId, programId]);
        if (!subject.rows[0]) throw httpError(400, "The subject is not assigned to this exact class and program.");
    }
    return { educationLevelId, gradeId, programId, subjectId };
}

async function ownedCourseFor(type, id) {
    const queries = {
        courses: "SELECT id AS course_id FROM library_courses WHERE id = $1",
        modules: "SELECT course_id FROM course_modules WHERE id = $1",
        lessons: "SELECT m.course_id FROM course_lessons l JOIN course_modules m ON m.id = l.module_id WHERE l.id = $1",
        notes: "SELECT m.course_id FROM lesson_notes x JOIN course_lessons l ON l.id = x.lesson_id JOIN course_modules m ON m.id = l.module_id WHERE x.id = $1",
        examples: "SELECT m.course_id FROM lesson_examples x JOIN course_lessons l ON l.id = x.lesson_id JOIN course_modules m ON m.id = l.module_id WHERE x.id = $1",
        exercises: "SELECT m.course_id FROM lesson_exercises x JOIN course_lessons l ON l.id = x.lesson_id JOIN course_modules m ON m.id = l.module_id WHERE x.id = $1",
        assignments: "SELECT course_id FROM library_assessments WHERE id = $1 AND kind = 'homework'",
        tests: "SELECT course_id FROM library_assessments WHERE id = $1 AND kind = 'test'",
        exams: "SELECT course_id FROM library_assessments WHERE id = $1 AND kind = 'exam'",
        quizzes: "SELECT course_id FROM library_quizzes WHERE id = $1",
    };
    const result = await pool.query(queries[type], [id]);
    if (!result.rows[0]) throw httpError(404, "Content not found.");
    return result.rows[0].course_id;
}

async function assertCourseTarget(courseId, target) {
    const result = await pool.query("SELECT id FROM library_courses WHERE id = $1 AND education_level_id = $2 AND grade_id IS NOT DISTINCT FROM $3::bigint AND program_id IS NOT DISTINCT FROM $4::bigint AND ($5::bigint IS NULL OR subject_id = $5)", [courseId, target.educationLevelId, target.gradeId, target.programId, target.subjectId]);
    if (!result.rows[0]) throw httpError(400, "The selected content does not match this education level, class, program, and subject.");
}

const listQueries = {
    levels: "SELECT id, code, name, category, position, id AS value FROM education_levels WHERE ($1::text IS NULL OR name ILIKE $2 OR code ILIKE $2) ORDER BY position, name",
    grades: "SELECT g.id, g.education_level_id, g.code, g.name, g.position, el.name AS education_level_name FROM grades g JOIN education_levels el ON el.id = g.education_level_id WHERE ($1::text IS NULL OR g.name ILIKE $2 OR g.code ILIKE $2 OR el.name ILIKE $2) AND ($3::bigint IS NULL OR g.education_level_id = $3) ORDER BY el.position, g.position, g.name",
    programs: "SELECT p.id, p.department_id, p.name, p.description, COALESCE(array_agg(tpl.grade_id::text) FILTER (WHERE tpl.grade_id IS NOT NULL), ARRAY[]::text[]) AS grade_ids FROM programs p LEFT JOIN tvet_program_levels tpl ON tpl.program_id = p.id WHERE ($1::text IS NULL OR p.name ILIKE $2 OR p.description ILIKE $2) GROUP BY p.id ORDER BY p.name",
    subjects: "SELECT s.id, s.name, s.description, s.education_level_id, s.grade_id, s.program_id FROM library_subjects s WHERE ($1::text IS NULL OR s.name ILIKE $2 OR s.description ILIKE $2) AND ($3::bigint IS NULL OR s.education_level_id = $3) AND ($4::bigint IS NULL OR s.grade_id = $4) AND ($5::bigint IS NULL OR s.program_id IS NOT DISTINCT FROM $5::bigint) ORDER BY s.name",
    courses: "SELECT c.id, c.title, c.description, c.difficulty, c.status, c.subject_id, c.education_level_id, c.grade_id, c.program_id, s.name AS subject, u.name AS teacher, c.teacher_id, c.created_at, c.updated_at FROM library_courses c JOIN library_subjects s ON s.id = c.subject_id LEFT JOIN users u ON u.id = c.teacher_id WHERE ($1::text IS NULL OR c.title ILIKE $2 OR c.description ILIKE $2 OR s.name ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY c.updated_at DESC, c.title",
    modules: "SELECT m.id, m.course_id, m.title, m.position, m.status, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM course_modules m JOIN library_courses c ON c.id = m.course_id WHERE ($1::text IS NULL OR m.title ILIKE $2 OR c.title ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY c.title, m.position",
    lessons: "SELECT l.id, l.module_id, l.title, l.explanation AS body, l.explanation AS content, l.position, l.status, l.language, m.title AS module, c.id AS course_id, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM course_lessons l JOIN course_modules m ON m.id = l.module_id JOIN library_courses c ON c.id = m.course_id WHERE ($1::text IS NULL OR l.title ILIKE $2 OR l.explanation ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY c.title, m.position, l.position",
    notes: "SELECT n.id, n.lesson_id, n.title, n.body, n.status, l.title AS lesson, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM lesson_notes n JOIN course_lessons l ON l.id = n.lesson_id JOIN course_modules m ON m.id = l.module_id JOIN library_courses c ON c.id = m.course_id WHERE ($1::text IS NULL OR n.title ILIKE $2 OR n.body ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY c.title, l.position, n.position",
    examples: "SELECT e.id, e.lesson_id, e.title, e.body, e.status, l.title AS lesson, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM lesson_examples e JOIN course_lessons l ON l.id = e.lesson_id JOIN course_modules m ON m.id = l.module_id JOIN library_courses c ON c.id = m.course_id WHERE ($1::text IS NULL OR e.title ILIKE $2 OR e.body ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY c.title, l.position, e.position",
    exercises: "SELECT x.id, x.lesson_id, x.prompt, x.answer, x.status, l.title AS lesson, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM lesson_exercises x JOIN course_lessons l ON l.id = x.lesson_id JOIN course_modules m ON m.id = l.module_id JOIN library_courses c ON c.id = m.course_id WHERE ($1::text IS NULL OR x.prompt ILIKE $2 OR x.answer ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY c.title, l.position, x.position",
    assignments: "SELECT a.id, a.course_id, a.title, a.instructions, a.due_at, a.total_marks, a.status, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM library_assessments a JOIN library_courses c ON c.id = a.course_id WHERE a.kind = 'homework' AND ($1::text IS NULL OR a.title ILIKE $2 OR a.instructions ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY a.due_at NULLS LAST",
    quizzes: "SELECT q.id, q.course_id, q.lesson_id, q.title, q.status, q.published, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM library_quizzes q JOIN library_courses c ON c.id = q.course_id WHERE ($1::text IS NULL OR q.title ILIKE $2 OR c.title ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY q.title",
    tests: "SELECT a.id, a.course_id, a.title, a.instructions, a.time_limit_seconds, a.status, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM library_assessments a JOIN library_courses c ON c.id = a.course_id WHERE a.kind = 'test' AND ($1::text IS NULL OR a.title ILIKE $2 OR a.instructions ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY a.title",
    exams: "SELECT a.id, a.course_id, a.title, a.time_limit_seconds, a.status, c.title AS course, c.education_level_id, c.grade_id, c.program_id, c.subject_id FROM library_assessments a JOIN library_courses c ON c.id = a.course_id WHERE a.kind = 'exam' AND ($1::text IS NULL OR a.title ILIKE $2 OR a.instructions ILIKE $2) AND ($3::bigint IS NULL OR c.education_level_id = $3) AND ($4::bigint IS NULL OR c.grade_id = $4) AND ($5::bigint IS NULL OR c.program_id IS NOT DISTINCT FROM $5::bigint) AND ($6::bigint IS NULL OR c.subject_id = $6) ORDER BY a.title",
};
const listParameterCounts = { levels: 2, grades: 3, programs: 2, subjects: 5, courses: 6, modules: 6, lessons: 6, notes: 6, examples: 6, exercises: 6, assignments: 6, quizzes: 6, tests: 6, exams: 6 };

router.get("/overview", async (req, res) => {
    try {
        const result = await pool.query(`SELECT
            (SELECT count(*)::int FROM users WHERE role = 'student') AS students,
            (SELECT count(*)::int FROM users WHERE role = 'teacher') AS teachers,
            (SELECT count(*)::int FROM users WHERE role = 'teacher' AND teacher_verification_status = 'pending') AS pending_teachers,
            (SELECT count(*)::int FROM library_courses) AS courses,
            (SELECT count(*)::int FROM library_subjects) AS subjects,
            (SELECT count(*)::int FROM library_courses WHERE status = 'published') AS published_courses,
            (SELECT count(*)::int FROM course_lessons WHERE status = 'published') AS published_lessons,
            (SELECT count(*)::int FROM library_courses WHERE status = 'draft') AS draft_courses,
            (SELECT count(*)::int FROM admin_audit_logs WHERE created_at >= now() - interval '30 days') AS recent_actions`);
        res.json({ data: result.rows[0]         });

        router.get("/class-dashboards", async (req, res) => {
            try {
                const result = await pool.query(`SELECT u.name AS full_name, u.email, d.class_code, d.data, d.updated_at
                    FROM class_dashboard_state d JOIN users u ON u.id = d.user_id
                    ORDER BY d.updated_at DESC LIMIT 500`);
                const data = result.rows.map(({ data: state, ...student }) => {
                    const taskGroups = state && state.tasks && typeof state.tasks === "object" && !Array.isArray(state.tasks) ? Object.values(state.tasks) : [];
                    const tasks = taskGroups.flatMap((group) => Array.isArray(group) ? group : []);
                    const scoreGroups = state && state.scores && typeof state.scores === "object" && !Array.isArray(state.scores) ? Object.values(state.scores) : [];
                    const scores = scoreGroups.flatMap((subject) =>
                        subject && typeof subject === "object" && !Array.isArray(subject)
                            ? Object.values(subject).filter((score) => typeof score === "number" && Number.isFinite(score))
                            : []);
                    return {
                        ...student,
                        tasks_completed: tasks.filter((task) => task && typeof task === "object" && (task.d === 1 || task.d === true)).length,
                        tasks_total: tasks.length,
                        quizzes_taken: scores.length,
                        average_score: scores.length ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length) : null
                    };
                });
                return res.json({ data });
            } catch (error) {
                console.error("CLASS DASHBOARD REPORT ERROR:", error);
                return res.status(500).json({ message: "Class dashboard report could not be loaded" });
            }
        });
    } catch (error) { console.error("ADMIN OVERVIEW ERROR:", error.message); res.status(500).json({ message: "Admin overview is temporarily unavailable." }); }
});

router.get("/taxonomy", async (_req, res) => {
    try {
        const [levels, grades, programs, subjects] = await Promise.all([
            pool.query("SELECT id, code, name, category, position FROM education_levels ORDER BY position, name"),
            pool.query("SELECT g.id, g.education_level_id, g.code, g.name, g.position, el.name AS education_level_name FROM grades g JOIN education_levels el ON el.id = g.education_level_id ORDER BY el.position, g.position, g.name"),
            pool.query("SELECT p.id, p.department_id, p.name, p.description, p.curriculum_verification_status, p.curriculum_source_reference, COALESCE(array_agg(tpl.grade_id::text) FILTER (WHERE tpl.grade_id IS NOT NULL), ARRAY[]::text[]) AS grade_ids FROM programs p LEFT JOIN tvet_program_levels tpl ON tpl.program_id = p.id GROUP BY p.id ORDER BY p.name"),
            pool.query("SELECT id, name, description, education_level_id, grade_id, program_id FROM library_subjects ORDER BY name"),
        ]);
        res.json({ data: { levels: levels.rows, grades: grades.rows, programs: programs.rows, subjects: subjects.rows } });
    } catch (error) { console.error("ADMIN TAXONOMY ERROR:", error.message); res.status(500).json({ message: "Admin taxonomy is temporarily unavailable." }); }
});

router.get("/curriculum-registry", async (_req, res) => {
    try {
        const [sources, versions, combinations, subjects, programs, curriculumUnits, curriculumOutcomes, tvetSubjects, tvetCompetences, tvetModules, tvetUnits, tvetOutcomes] = await Promise.all([
            pool.query("SELECT id, authority, title, url, published_on, checked_on, verification_status FROM curriculum_sources ORDER BY authority, title"),
            pool.query("SELECT v.id, v.source_id, s.title AS source_title, s.verification_status, v.version_label, v.status, v.effective_from FROM curriculum_versions v JOIN curriculum_sources s ON s.id = v.source_id ORDER BY s.authority, v.version_label"),
            pool.query("SELECT c.id, c.curriculum_version_id, c.education_level_id, c.code, c.name, c.description, l.name AS education_level_name, v.version_label, v.status AS version_status, src.verification_status FROM curriculum_combinations c JOIN education_levels l ON l.id = c.education_level_id JOIN curriculum_versions v ON v.id = c.curriculum_version_id JOIN curriculum_sources src ON src.id = v.source_id ORDER BY l.position, c.name"),
            pool.query("SELECT s.id, s.curriculum_version_id, s.education_level_id, s.grade_id, s.program_id, s.combination_id, s.code, s.name, s.description, s.source_reference, l.name AS education_level_name, g.name AS grade_name, v.version_label, v.status AS version_status, src.verification_status FROM curriculum_subjects s JOIN education_levels l ON l.id = s.education_level_id JOIN curriculum_versions v ON v.id = s.curriculum_version_id JOIN curriculum_sources src ON src.id = v.source_id LEFT JOIN grades g ON g.id = s.grade_id ORDER BY l.position, g.position NULLS FIRST, s.name"),
            pool.query("SELECT p.id, p.name, p.description, p.curriculum_verification_status, p.curriculum_source_reference, COALESCE(array_agg(tpl.grade_id::text) FILTER (WHERE tpl.grade_id IS NOT NULL), ARRAY[]::text[]) AS grade_ids FROM programs p LEFT JOIN tvet_program_levels tpl ON tpl.program_id = p.id GROUP BY p.id ORDER BY p.name"),
            pool.query("SELECT u.id, u.curriculum_subject_id, u.code, u.title, u.description, u.position, u.source_reference, u.status, s.name AS subject_name FROM curriculum_units u JOIN curriculum_subjects s ON s.id = u.curriculum_subject_id ORDER BY s.name, u.position"),
            pool.query("SELECT o.id, o.unit_id, o.code, o.description, o.position, o.source_reference, o.status, u.title AS unit_title FROM curriculum_learning_outcomes o JOIN curriculum_units u ON u.id = o.unit_id ORDER BY u.position, o.position"),
            pool.query("SELECT s.id, s.program_id, s.grade_id, s.curriculum_version_id, s.code, s.name, s.description, s.source_reference, s.status, p.name AS program_name, g.name AS grade_name, v.status AS version_status, src.verification_status FROM tvet_subjects s JOIN programs p ON p.id = s.program_id JOIN grades g ON g.id = s.grade_id JOIN curriculum_versions v ON v.id = s.curriculum_version_id JOIN curriculum_sources src ON src.id = v.source_id ORDER BY p.name, g.position, s.name"),
            pool.query("SELECT c.id, c.subject_id, c.code, c.title, c.description, c.position, c.status, s.name AS subject_name FROM tvet_competences c JOIN tvet_subjects s ON s.id = c.subject_id ORDER BY s.name, c.position"),
            pool.query("SELECT m.id, m.competence_id, m.title, m.description, m.position, m.status, c.title AS competence_title FROM tvet_modules m JOIN tvet_competences c ON c.id = m.competence_id ORDER BY c.position, m.position"),
            pool.query("SELECT u.id, u.module_id, u.title, u.description, u.position, u.status, m.title AS module_title FROM tvet_units u JOIN tvet_modules m ON m.id = u.module_id ORDER BY m.position, u.position"),
            pool.query("SELECT o.id, o.unit_id, o.code, o.description, o.position, o.status, u.title AS unit_title FROM tvet_learning_outcomes o JOIN tvet_units u ON u.id = o.unit_id ORDER BY u.position, o.position"),
        ]);
        res.json({ data: { sources: sources.rows, versions: versions.rows, combinations: combinations.rows, subjects: subjects.rows, programs: programs.rows, curriculumUnits: curriculumUnits.rows, curriculumOutcomes: curriculumOutcomes.rows, tvetSubjects: tvetSubjects.rows, tvetCompetences: tvetCompetences.rows, tvetModules: tvetModules.rows, tvetUnits: tvetUnits.rows, tvetOutcomes: tvetOutcomes.rows } });
    } catch (error) { console.error("ADMIN CURRICULUM REGISTRY ERROR:", error); res.status(500).json({ message: "Curriculum registry is temporarily unavailable. Apply the legacy curriculum migrations first." }); }
});

router.get("/learning-material-options", async (_req, res) => {
    try {
        const [curriculumUnits, tvetUnits, courseLessons, tvetLessons] = await Promise.all([
            pool.query(`SELECT u.id, u.curriculum_subject_id AS subject_id, s.curriculum_version_id, s.education_level_id,
                    s.grade_id, s.program_id, u.title, s.name AS subject_name
                FROM curriculum_units u JOIN curriculum_subjects s ON s.id = u.curriculum_subject_id
                WHERE u.status = 'published' ORDER BY s.name, u.position, u.title`),
            pool.query(`SELECT u.id, c.subject_id AS tvet_subject_id, s.curriculum_version_id, s.grade_id,
                    s.program_id, u.title, s.name AS subject_name, p.name AS program_name, g.name AS grade_name
                FROM tvet_units u JOIN tvet_modules m ON m.id = u.module_id
                JOIN tvet_competences c ON c.id = m.competence_id JOIN tvet_subjects s ON s.id = c.subject_id
                JOIN programs p ON p.id = s.program_id JOIN grades g ON g.id = s.grade_id
                WHERE u.status = 'published'
                ORDER BY p.name, g.position, s.name, u.position`),
            pool.query(`SELECT l.id, c.education_level_id, c.grade_id, c.program_id,
                    mapping.curriculum_subject_id AS subject_id,
                    l.title, c.title AS course_title
                FROM course_lessons l JOIN course_modules m ON m.id = l.module_id
                JOIN library_courses c ON c.id = m.course_id
                LEFT JOIN curriculum_subject_library_subjects mapping ON mapping.library_subject_id = c.subject_id
                ORDER BY c.title, m.position, l.position`),
            pool.query(`SELECT l.id, s.id AS tvet_subject_id, p.name AS program_name, g.name AS grade_name,
                    s.name AS subject_name, l.title, u.title AS unit_title
                FROM tvet_lessons l JOIN tvet_units u ON u.id = l.unit_id
                JOIN tvet_modules m ON m.id = u.module_id JOIN tvet_competences c ON c.id = m.competence_id
                JOIN tvet_subjects s ON s.id = c.subject_id JOIN programs p ON p.id = s.program_id
                JOIN grades g ON g.id = s.grade_id
                WHERE l.status = 'published' AND u.status = 'published'
                    AND m.status = 'published' AND c.status = 'published'
                ORDER BY p.name, g.position, s.name, l.position`),
        ]);
        res.json({ data: { curriculumUnits: curriculumUnits.rows, tvetUnits: tvetUnits.rows, courseLessons: courseLessons.rows, tvetLessons: tvetLessons.rows } });
    } catch (error) {
        console.error("ADMIN LEARNING MATERIAL OPTIONS ERROR:", error);
        res.status(500).json({ message: "Learning material assignment options could not be loaded." });
    }
});

router.get("/learning-materials", async (req, res) => {
    const search = text(req.query.search, "Search", false, 200);
    try {
        const result = await pool.query(`SELECT m.id, m.title, m.description, m.material_type, m.source_type, m.url,
                m.publisher, m.edition, m.source_reference, (m.rights_confirmed_at IS NOT NULL) AS rights_confirmed,
                m.original_filename, m.content_type, m.size_bytes, m.status, m.processing_status, m.processing_error,
                m.processed_at, m.created_at, m.updated_at, m.education_level_id, m.grade_id, m.program_id,
                m.subject_id, m.tvet_subject_id, m.curriculum_unit_id, m.tvet_unit_id, m.course_lesson_id,
                m.tvet_lesson_id, m.curriculum_version_id, school.id AS school_id, school.name AS school_name,
                level.name AS education_level_name, grade.name AS grade_name, program.name AS program_name,
                COALESCE(curriculum_subject.name, tvet_subject.name) AS subject_name,
                COALESCE(curriculum_unit.title, tvet_unit.title) AS unit_name,
                COALESCE(course_lesson.title, tvet_lesson.title) AS lesson_name
            FROM curriculum_materials m
            JOIN school_textbook_assignments assignment ON assignment.material_id = m.id
            JOIN admin_schools school ON school.id = assignment.school_id
            JOIN education_levels level ON level.id = m.education_level_id
            LEFT JOIN grades grade ON grade.id = m.grade_id
            LEFT JOIN programs program ON program.id = m.program_id
            LEFT JOIN curriculum_subjects curriculum_subject ON curriculum_subject.id = m.subject_id
            LEFT JOIN tvet_subjects tvet_subject ON tvet_subject.id = m.tvet_subject_id
            LEFT JOIN curriculum_units curriculum_unit ON curriculum_unit.id = m.curriculum_unit_id
            LEFT JOIN tvet_units tvet_unit ON tvet_unit.id = m.tvet_unit_id
            LEFT JOIN course_lessons course_lesson ON course_lesson.id = m.course_lesson_id
            LEFT JOIN tvet_lessons tvet_lesson ON tvet_lesson.id = m.tvet_lesson_id
            WHERE ($1 = '' OR m.title ILIKE '%' || $1 || '%' OR m.description ILIKE '%' || $1 || '%'
                OR school.name ILIKE '%' || $1 || '%' OR COALESCE(curriculum_subject.name, tvet_subject.name, '') ILIKE '%' || $1 || '%')
            ORDER BY m.updated_at DESC, m.id DESC LIMIT 200`, [search]);
        res.json({ data: result.rows });
    } catch (error) {
        console.error("ADMIN LEARNING MATERIALS ERROR:", error);
        res.status(500).json({ message: "Learning materials could not be loaded. Apply the learning materials migration first." });
    }
});

router.get("/learning-materials/:id/file", async (req, res) => {
    const materialId = positiveInteger(req.params.id, "Material");
    try {
        const result = await pool.query("SELECT storage_key, original_filename FROM curriculum_materials WHERE id = $1 AND source_type = 'upload'", [materialId]);
        if (!result.rows[0]) return res.status(404).json({ message: "Uploaded material not found." });
        const filePath = storagePath(result.rows[0].storage_key);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "private, no-store");
        res.type("application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${String(result.rows[0].original_filename || "learning-material.pdf").replace(/[\r\n"]/g, "_")}"`);
        return res.sendFile(filePath, (error) => {
            if (!error) return;
            console.error("ADMIN LEARNING MATERIAL SEND ERROR:", error);
            if (!res.headersSent) res.status(error.statusCode || 404).json({ message: "The stored PDF could not be loaded." });
        });
    } catch (error) {
        console.error("ADMIN LEARNING MATERIAL PREVIEW ERROR:", error);
        return res.status(500).json({ message: "The stored PDF could not be loaded." });
    }
});

router.post("/learning-materials", async (req, res) => {
    let input;
    try {
        input = parseLearningMaterialInput(req.body);
        const resourceUrl = text(req.body.url, "Resource URL", true, 4000);
        let source;
        try {
            source = await fetchPublicResource(resourceUrl);
            source.readableText = await extractReadableContent(source.buffer, source.contentType);
        } catch (error) {
            return res.status(422).json({ message: error instanceof Error ? error.message : "The resource could not be accessed or processed." });
        }
        source.type = "url";
        const created = await insertLearningMaterial(input, req.auth.userId, source);
        queueMaterialProcessing(created.id, source);
        return res.status(201).json({ data: created });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error("ADMIN LEARNING MATERIAL URL CREATE ERROR:", error);
        return res.status(500).json({ message: "The learning resource could not be saved." });
    }
});

function receiveLearningPdf(req, res, next) {
    materialUpload.single("file")(req, res, (error) => {
        if (!error) return next();
        if (error.code === "LIMIT_FILE_SIZE") error.status = 413;
        return next(error);
    });
}

router.post("/learning-materials/upload", receiveLearningPdf, async (req, res) => {
    let storageKey;
    try {
        if (!req.file) return res.status(400).json({ message: "Choose a PDF file under 15 MB." });
        const input = parseLearningMaterialInput(req.body);
        storageKey = await storePdf(req.file.buffer);
        const created = await insertLearningMaterial(input, req.auth.userId, {
            type: "upload", storageKey, filename: req.file.originalname.replace(/[\r\n"]/g, "_").slice(0, 255),
            contentType: "application/pdf", size: req.file.size,
        });
        queueMaterialProcessing(created.id);
        return res.status(201).json({ data: created });
    } catch (error) {
        if (storageKey) {
            try { await fs.unlink(storagePath(storageKey)); }
            catch (cleanupError) { console.error("LEARNING MATERIAL UPLOAD CLEANUP ERROR:", cleanupError); }
        }
        if (error.status) return res.status(error.status).json({ message: error.message });
        if (error.message && error.message.startsWith("Upload a valid PDF")) return res.status(415).json({ message: error.message });
        console.error("ADMIN LEARNING MATERIAL UPLOAD ERROR:", error);
        return res.status(500).json({ message: "The PDF could not be uploaded." });
    }
});

router.post("/learning-materials/:id/replace", receiveLearningPdf, async (req, res) => {
    const materialId = positiveInteger(req.params.id, "Material");
    let storageKey;
    try {
        if (!req.file) return res.status(400).json({ message: "Choose a PDF file under 15 MB." });
        const input = parseLearningMaterialInput(req.body);
        await validateLearningMaterialScope(input);
        storageKey = await storePdf(req.file.buffer);
        const client = await pool.connect();
        let updated;
        try {
            await client.query("BEGIN");
            const existing = await client.query("SELECT storage_key FROM curriculum_materials WHERE id = $1 AND source_type = 'upload' FOR UPDATE", [materialId]);
            if (!existing.rows[0]) {
                await client.query("ROLLBACK");
                throw httpError(404, "Uploaded learning material not found.");
            }
            updated = await client.query(`UPDATE curriculum_materials SET curriculum_version_id = $1,
                education_level_id = $2, grade_id = $3, program_id = $4, subject_id = $5, material_type = $6,
                title = $7, description = $8, publisher = $9, edition = $10, source_reference = $11,
                tvet_subject_id = $12, curriculum_unit_id = $13, tvet_unit_id = $14, course_lesson_id = $15,
                tvet_lesson_id = $16, storage_key = $17, original_filename = $18, content_type = 'application/pdf',
                size_bytes = $19, status = 'draft', processing_status = 'pending', processing_started_at = NULL,
                processing_error = '', processed_at = NULL, content_revision = content_revision + 1,
                rights_confirmed_by = $20, rights_confirmed_at = now(), updated_at = now()
                WHERE id = $21 RETURNING id, title, description, material_type, source_type, status, processing_status`, [
                input.curriculumVersionId, input.educationLevelId, input.gradeId, input.programId, input.subjectId,
                input.materialType, input.title, input.description, input.publisher, input.edition, input.sourceReference,
                input.tvetSubjectId, input.curriculumUnitId, input.tvetUnitId, input.courseLessonId, input.tvetLessonId,
                storageKey, req.file.originalname.replace(/[\r\n"]/g, "_").slice(0, 255), req.file.size,
                req.auth.userId, materialId,
            ]);
            await client.query("DELETE FROM learning_material_chunks WHERE material_id = $1", [materialId]);
            await client.query("DELETE FROM school_textbook_assignments WHERE material_id = $1", [materialId]);
            await client.query("INSERT INTO school_textbook_assignments (school_id, material_id, assigned_by) VALUES ($1, $2, $3)", [input.schoolId, materialId, req.auth.userId]);
            await client.query("INSERT INTO admin_audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)", [
                req.auth.userId, "learning_material.file_replaced", "curriculum_material", String(materialId),
                JSON.stringify({ schoolId: input.schoolId, sizeBytes: req.file.size }),
            ]);
            await client.query("COMMIT");
            try {
                if (existing.rows[0].storage_key) await fs.unlink(storagePath(existing.rows[0].storage_key));
            } catch (error) {
                if (error.code !== "ENOENT") console.error("REPLACED LEARNING MATERIAL CLEANUP ERROR:", error);
            }
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
        storageKey = null;
        queueMaterialProcessing(materialId);
        return res.json({ data: updated.rows[0] });
    } catch (error) {
        if (storageKey) {
            try { await fs.unlink(storagePath(storageKey)); }
            catch (cleanupError) { console.error("LEARNING MATERIAL REPLACEMENT CLEANUP ERROR:", cleanupError); }
        }
        if (error.status) return res.status(error.status).json({ message: error.message });
        if (error.message && error.message.startsWith("Upload a valid PDF")) return res.status(415).json({ message: error.message });
        console.error("ADMIN LEARNING MATERIAL REPLACEMENT ERROR:", error);
        return res.status(500).json({ message: "The learning material could not be replaced." });
    }
});

router.patch("/learning-materials/:id", async (req, res) => {
    const materialId = positiveInteger(req.params.id, "Material");
    try {
        const input = parseLearningMaterialInput(req.body);
        const existing = await pool.query("SELECT source_type, storage_key, url FROM curriculum_materials WHERE id = $1", [materialId]);
        if (!existing.rows[0]) return res.status(404).json({ message: "Learning material not found." });
        let source = null;
        if (existing.rows[0].source_type === "url") {
            try {
                source = await fetchPublicResource(text(req.body.url, "Resource URL", true, 4000));
                source.readableText = await extractReadableContent(source.buffer, source.contentType);
            } catch (error) {
                return res.status(422).json({ message: error instanceof Error ? error.message : "The resource could not be accessed or processed." });
            }
        }
        await validateLearningMaterialScope(input);
        const client = await pool.connect();
        let updated;
        try {
            await client.query("BEGIN");
            updated = await client.query(`UPDATE curriculum_materials SET curriculum_version_id = $1, education_level_id = $2,
                grade_id = $3, program_id = $4, subject_id = $5, material_type = $6, title = $7, description = $8,
                publisher = $9, edition = $10, url = $11, source_reference = $12, tvet_subject_id = $13,
                curriculum_unit_id = $14, tvet_unit_id = $15, course_lesson_id = $16, tvet_lesson_id = $17,
                rights_confirmed_by = $18, rights_confirmed_at = now(),
                content_revision = content_revision + CASE WHEN $19 THEN 1 ELSE 0 END,
                processing_status = CASE WHEN $19 THEN 'pending' ELSE processing_status END,
                processing_started_at = CASE WHEN $19 THEN NULL ELSE processing_started_at END,
                processing_error = CASE WHEN $19 THEN '' ELSE processing_error END,
                processed_at = CASE WHEN $19 THEN NULL ELSE processed_at END, updated_at = now()
                WHERE id = $20 RETURNING id, title, description, material_type, source_type, status, processing_status`, [
                input.curriculumVersionId, input.educationLevelId, input.gradeId, input.programId, input.subjectId,
                input.materialType, input.title, input.description, input.publisher, input.edition,
                source ? source.url : (req.body.url || existing.rows[0].url), input.sourceReference, input.tvetSubjectId,
                input.curriculumUnitId, input.tvetUnitId, input.courseLessonId, input.tvetLessonId,
                req.auth.userId, Boolean(source), materialId,
            ]);
            await client.query("DELETE FROM learning_material_chunks WHERE material_id = $1 AND $2", [materialId, Boolean(source)]);
            await client.query("DELETE FROM school_textbook_assignments WHERE material_id = $1", [materialId]);
            await client.query("INSERT INTO school_textbook_assignments (school_id, material_id, assigned_by) VALUES ($1, $2, $3)", [input.schoolId, materialId, req.auth.userId]);
            await client.query("INSERT INTO admin_audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)", [
                req.auth.userId, "learning_material.updated", "curriculum_material", String(materialId),
                JSON.stringify({ schoolId: input.schoolId }),
            ]);
            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
        if (source) queueMaterialProcessing(materialId, source);
        return res.json({ data: updated.rows[0] });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error("ADMIN LEARNING MATERIAL UPDATE ERROR:", error);
        return res.status(500).json({ message: "Learning material could not be updated." });
    }
});

router.patch("/learning-materials/:id/status", async (req, res) => {
    const materialId = positiveInteger(req.params.id, "Material");
    const status = text(req.body.status, "Status", true, 20);
    if (!["draft", "published", "retired"].includes(status)) return res.status(400).json({ message: "Choose a valid material status." });
    try {
        const result = await pool.query(`UPDATE curriculum_materials m SET status = $1, updated_at = now()
            WHERE m.id = $2 AND ($1 <> 'published' OR (m.processing_status = 'completed' AND m.rights_confirmed_at IS NOT NULL AND EXISTS (
                SELECT 1 FROM school_textbook_assignments a JOIN admin_schools s ON s.id = a.school_id
                WHERE a.material_id = m.id AND s.status = 'active')))
            RETURNING id, status, processing_status`, [status, materialId]);
        if (!result.rows[0]) return res.status(400).json({ message: "Publish only successfully processed materials assigned to an active school." });
        await audit(req, `learning_material.${status}`, "curriculum_material", materialId);
        return res.json({ data: result.rows[0] });
    } catch (error) {
        console.error("ADMIN LEARNING MATERIAL STATUS ERROR:", error);
        return res.status(500).json({ message: "Learning material status could not be changed." });
    }
});

router.post("/learning-materials/:id/retry", async (req, res) => {
    const materialId = positiveInteger(req.params.id, "Material");
    try {
        const result = await pool.query(`UPDATE curriculum_materials SET processing_status = 'pending', processing_error = '',
            processing_started_at = NULL, processed_at = NULL, content_revision = content_revision + 1, updated_at = now()
            WHERE id = $1 AND processing_status = 'failed'
            RETURNING id, source_type, url`, [materialId]);
        if (!result.rows[0]) return res.status(404).json({ message: "Only failed materials can be retried." });
        queueMaterialProcessing(materialId);
        await audit(req, "learning_material.processing_retried", "curriculum_material", materialId);
        return res.json({ data: { id: result.rows[0].id, processing_status: "pending" } });
    } catch (error) {
        console.error("ADMIN LEARNING MATERIAL RETRY ERROR:", error);
        return res.status(500).json({ message: "Material processing could not be retried." });
    }
});

router.delete("/learning-materials/:id", async (req, res) => {
    const materialId = positiveInteger(req.params.id, "Material");
    try {
        const result = await pool.query("DELETE FROM curriculum_materials WHERE id = $1 RETURNING id, storage_key", [materialId]);
        if (!result.rows[0]) return res.status(404).json({ message: "Learning material not found." });
        if (result.rows[0].storage_key) {
            try { await fs.unlink(storagePath(result.rows[0].storage_key)); }
            catch (error) {
                if (error.code !== "ENOENT") {
                    console.error("LEARNING MATERIAL FILE CLEANUP ERROR:", error);
                    return res.status(500).json({ message: "The material record was deleted but its stored PDF could not be removed." });
                }
            }
        }
        await audit(req, "learning_material.deleted", "curriculum_material", materialId);
        return res.status(204).send();
    } catch (error) {
        console.error("ADMIN LEARNING MATERIAL DELETE ERROR:", error);
        return res.status(500).json({ message: "Learning material could not be deleted." });
    }
});

router.patch("/curriculum-sources/:id/verification", async (req, res) => {
    const sourceId = positiveInteger(req.params.id, "Source ID");
    const verificationStatus = text(req.body.verificationStatus);
    if (!["unverified", "in_review", "verified"].includes(verificationStatus)) return res.status(400).json({ message: "Invalid source verification status." });
    try {
        const result = await pool.query(`UPDATE curriculum_sources
            SET verification_status = $1, checked_on = CASE WHEN $1 = 'verified' THEN CURRENT_DATE ELSE checked_on END,
                verified_by = CASE WHEN $1 = 'verified' THEN $2 ELSE NULL END
            WHERE id = $3 RETURNING id, authority, title, url, checked_on, verification_status`, [verificationStatus, req.auth.userId, sourceId]);
        if (!result.rows[0]) return res.status(404).json({ message: "Curriculum source not found." });
        await audit(req, "curriculum.source_verification_changed", "curriculum_source", sourceId, { verificationStatus });
        res.json({ data: result.rows[0] });
    } catch (error) { console.error("ADMIN CURRICULUM SOURCE VERIFICATION ERROR:", error); res.status(500).json({ message: "Source verification could not be updated." }); }
});

router.patch("/curriculum-versions/:id/status", async (req, res) => {
    const versionId = positiveInteger(req.params.id, "Version ID");
    const status = text(req.body.status);
    if (!["draft", "active", "retired"].includes(status)) return res.status(400).json({ message: "Invalid curriculum version status." });
    try {
        const result = await pool.query(`UPDATE curriculum_versions v SET status = $1
            WHERE v.id = $2 AND ($1 <> 'active' OR EXISTS (
                SELECT 1 FROM curriculum_sources s WHERE s.id = v.source_id AND s.verification_status = 'verified'
            )) RETURNING v.id, v.version_label, v.status, v.source_id`, [status, versionId]);
        if (!result.rows[0]) return res.status(400).json({ message: "Version not found, or its source must be verified before activation." });
        await audit(req, "curriculum.version_status_changed", "curriculum_version", versionId, { status });
        res.json({ data: result.rows[0] });
    } catch (error) { console.error("ADMIN CURRICULUM VERSION STATUS ERROR:", error); res.status(500).json({ message: "Curriculum version status could not be updated." }); }
});

router.patch("/programs/:id/curriculum-verification", async (req, res) => {
    const programId = positiveInteger(req.params.id, "Program ID");
    const verificationStatus = text(req.body.verificationStatus);
    const sourceReference = text(req.body.sourceReference, "Source reference", verificationStatus === "verified", 2000);
    if (!["unverified", "in_review", "verified"].includes(verificationStatus)) return res.status(400).json({ message: "Invalid program verification status." });
    try {
        const result = await pool.query(`UPDATE programs
            SET curriculum_verification_status = $1, curriculum_source_reference = $2
            WHERE id = $3 RETURNING id, name, curriculum_verification_status, curriculum_source_reference`, [verificationStatus, sourceReference, programId]);
        if (!result.rows[0]) return res.status(404).json({ message: "Program not found." });
        await audit(req, "curriculum.program_verification_changed", "program", programId, { verificationStatus });
        res.json({ data: result.rows[0] });
    } catch (error) { console.error("ADMIN CURRICULUM PROGRAM VERIFICATION ERROR:", error); res.status(500).json({ message: "Program verification could not be updated." }); }
});

router.post("/curriculum-combinations", async (req, res) => {
    const versionId = positiveInteger(req.body.curriculumVersionId, "Curriculum version");
    const educationLevelId = positiveInteger(req.body.educationLevelId, "Education level");
    const code = text(req.body.code, "Combination code", true, 80);
    const name = text(req.body.name, "Combination name", true, 200);
    const description = text(req.body.description, "Description", false, 2000);
    const sourceReference = text(req.body.sourceReference, "Source reference", true, 2000);
    try {
        const result = await pool.query(`INSERT INTO curriculum_combinations (curriculum_version_id, education_level_id, code, name, description, source_reference)
            SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (
                SELECT 1 FROM curriculum_versions WHERE id = $1
            ) AND EXISTS (SELECT 1 FROM education_levels WHERE id = $2)
            RETURNING id, curriculum_version_id, education_level_id, code, name, description, source_reference`, [versionId, educationLevelId, code, name, description, sourceReference]);
        if (!result.rows[0]) return res.status(400).json({ message: "Choose an existing curriculum version and education level." });
        await audit(req, "curriculum.combination_created", "curriculum_combination", result.rows[0].id);
        res.status(201).json({ data: result.rows[0] });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "That combination code already exists in this version and level." });
        console.error("ADMIN CURRICULUM COMBINATION CREATE ERROR:", error);
        res.status(500).json({ message: "Curriculum combination could not be created." });
    }
});

router.patch("/students/:id/subject-combination", async (req, res) => {
    const studentId = positiveInteger(req.params.id, "Student ID");
    const combinationId = optionalInteger(req.body.combinationId);
    if (combinationId && combinationId.error) return res.status(400).json({ message: combinationId.error });
    try {
        const result = await pool.query(`UPDATE users u SET subject_combination_id = $1
            WHERE u.id = $2 AND u.role = 'student'
                AND ($1::bigint IS NULL OR EXISTS (
                    SELECT 1 FROM curriculum_combinations c
                    JOIN curriculum_versions v ON v.id = c.curriculum_version_id AND v.status = 'active'
                    JOIN curriculum_sources src ON src.id = v.source_id AND src.verification_status = 'verified'
                    WHERE c.id = $1 AND c.education_level_id = u.education_level_id
                ))
            RETURNING id, education_level_id, grade_id, subject_combination_id`, [combinationId, studentId]);
        if (!result.rows[0]) return res.status(400).json({ message: "Student or active verified combination not found, or the combination does not match the student's education level." });
        await audit(req, "curriculum.student_combination_changed", "student", studentId, { combinationId });
        res.json({ data: result.rows[0] });
    } catch (error) { console.error("ADMIN STUDENT COMBINATION ERROR:", error); res.status(500).json({ message: "Student subject combination could not be updated." }); }
});

router.post("/curriculum-subjects", async (req, res) => {
    const versionId = positiveInteger(req.body.curriculumVersionId, "Curriculum version");
    const educationLevelId = positiveInteger(req.body.educationLevelId, "Education level");
    const gradeId = optionalInteger(req.body.gradeId);
    const programId = optionalInteger(req.body.programId);
    const combinationId = optionalInteger(req.body.combinationId);
    const code = text(req.body.code, "Subject code", true, 100);
    const name = text(req.body.name, "Subject name", true, 200);
    const description = text(req.body.description, "Description", false, 2000);
    const sourceReference = text(req.body.sourceReference, "Source reference", true, 2000);
    const invalid = [gradeId, programId, combinationId].find((item) => item && item.error);
    if (invalid) return res.status(400).json({ message: invalid.error });
    try {
        const target = await pool.query(`SELECT 1 FROM curriculum_versions v
            JOIN education_levels l ON l.id = $2
            WHERE v.id = $1
                AND ($3::bigint IS NULL OR EXISTS (SELECT 1 FROM grades g WHERE g.id = $3 AND g.education_level_id = $2))
                AND ($4::bigint IS NULL OR EXISTS (SELECT 1 FROM programs p WHERE p.id = $4))
                AND ($5::bigint IS NULL OR EXISTS (SELECT 1 FROM curriculum_combinations c WHERE c.id = $5 AND c.curriculum_version_id = $1 AND c.education_level_id = $2))`, [versionId, educationLevelId, gradeId, programId, combinationId]);
        if (!target.rows[0]) return res.status(400).json({ message: "The class, program, combination and curriculum version must match the selected education level." });
        const result = await pool.query(`INSERT INTO curriculum_subjects (curriculum_version_id, education_level_id, grade_id, program_id, combination_id, code, name, description, source_reference)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id, curriculum_version_id, education_level_id, grade_id, program_id, combination_id, code, name, description, source_reference`, [versionId, educationLevelId, gradeId, programId, combinationId, code, name, description, sourceReference]);
        await audit(req, "curriculum.subject_created", "curriculum_subject", result.rows[0].id);
        res.status(201).json({ data: result.rows[0] });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "That subject code already exists for the selected curriculum mapping." });
        console.error("ADMIN CURRICULUM SUBJECT CREATE ERROR:", error);
        res.status(500).json({ message: "Curriculum subject could not be created." });
    }
});

router.post("/curriculum-units", async (req, res) => {
    const subjectId = positiveInteger(req.body.curriculumSubjectId, "Curriculum subject");
    const code = text(req.body.code, "Unit code", true, 100);
    const title = text(req.body.title, "Unit title", true, 240);
    const description = text(req.body.description, "Description", false, 2000);
    const sourceReference = text(req.body.sourceReference, "Source reference", true, 2000);
    const position = Number(req.body.position);
    if (!Number.isInteger(position) || position < 1) return res.status(400).json({ message: "Unit position must be a positive integer." });
    try {
        const result = await pool.query(`INSERT INTO curriculum_units (curriculum_subject_id, code, title, description, position, source_reference)
            SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (
                SELECT 1 FROM curriculum_subjects s JOIN curriculum_versions v ON v.id = s.curriculum_version_id AND v.status = 'active'
                JOIN curriculum_sources src ON src.id = v.source_id AND src.verification_status = 'verified'
                WHERE s.id = $1
            ) RETURNING id, curriculum_subject_id, code, title, description, position, source_reference, status`, [subjectId, code, title, description, position, sourceReference]);
        if (!result.rows[0]) return res.status(400).json({ message: "Choose a subject mapping with an active verified curriculum source." });
        await audit(req, "curriculum.unit_created", "curriculum_unit", result.rows[0].id);
        res.status(201).json({ data: result.rows[0] });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "That unit code already exists for this subject." });
        console.error("ADMIN CURRICULUM UNIT CREATE ERROR:", error);
        res.status(500).json({ message: "Curriculum unit could not be created." });
    }
});

router.post("/curriculum-units/:id/outcomes", async (req, res) => {
    const unitId = positiveInteger(req.params.id, "Curriculum unit");
    const code = text(req.body.code, "Outcome code", true, 100);
    const description = text(req.body.description, "Learning outcome", true, 4000);
    const sourceReference = text(req.body.sourceReference, "Source reference", true, 2000);
    const position = Number(req.body.position);
    if (!Number.isInteger(position) || position < 1) return res.status(400).json({ message: "Outcome position must be a positive integer." });
    try {
        const result = await pool.query(`INSERT INTO curriculum_learning_outcomes (unit_id, code, description, position, source_reference)
            SELECT $1, $2, $3, $4, $5 WHERE EXISTS (
                SELECT 1 FROM curriculum_units u JOIN curriculum_subjects s ON s.id = u.curriculum_subject_id
                JOIN curriculum_versions v ON v.id = s.curriculum_version_id AND v.status = 'active'
                JOIN curriculum_sources src ON src.id = v.source_id AND src.verification_status = 'verified'
                WHERE u.id = $1
            ) RETURNING id, unit_id, code, description, position, source_reference, status`, [unitId, code, description, position, sourceReference]);
        if (!result.rows[0]) return res.status(400).json({ message: "Choose a unit in an active verified curriculum." });
        await audit(req, "curriculum.outcome_created", "curriculum_learning_outcome", result.rows[0].id);
        res.status(201).json({ data: result.rows[0] });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "That outcome code already exists for this unit." });
        console.error("ADMIN CURRICULUM OUTCOME CREATE ERROR:", error);
        res.status(500).json({ message: "Curriculum learning outcome could not be created." });
    }
});

router.patch("/curriculum-records/:type/:id/status", async (req, res) => {
    const config = {
        units: { table: "curriculum_units", entity: "curriculum_unit" },
        outcomes: { table: "curriculum_learning_outcomes", entity: "curriculum_learning_outcome" },
    }[req.params.type];
    const id = positiveInteger(req.params.id, "Curriculum record");
    const status = text(req.body.status);
    if (!config || !["draft", "published", "retired"].includes(status)) return res.status(400).json({ message: "Invalid curriculum record type or status." });
    try {
        const result = await pool.query(`UPDATE ${config.table} SET status = $1 WHERE id = $2 RETURNING id, status`, [status, id]);
        if (!result.rows[0]) return res.status(404).json({ message: "Curriculum record not found." });
        await audit(req, "curriculum.record_status_changed", config.entity, id, { status });
        res.json({ data: result.rows[0] });
    } catch (error) { console.error("ADMIN CURRICULUM RECORD STATUS ERROR:", error); res.status(500).json({ message: "Curriculum record status could not be changed." }); }
});

router.post("/curriculum-materials", async (req, res) => {
    const versionId = positiveInteger(req.body.curriculumVersionId, "Curriculum version");
    const educationLevelId = positiveInteger(req.body.educationLevelId, "Education level");
    const gradeId = optionalInteger(req.body.gradeId);
    const programId = optionalInteger(req.body.programId);
    const subjectId = optionalInteger(req.body.subjectId);
    const schoolId = optionalInteger(req.body.schoolId);
    const materialType = text(req.body.materialType, "Material type");
    const title = text(req.body.title, "Material title", true, 240);
    const publisher = text(req.body.publisher, "Publisher", false, 200);
    const edition = text(req.body.edition, "Edition", false, 120);
    const url = text(req.body.url, "Material URL", true, 4000);
    const sourceReference = text(req.body.sourceReference, "Source reference", true, 2000);
    const invalid = [gradeId, programId, subjectId, schoolId].find((item) => item && item.error);
    if (invalid) return res.status(400).json({ message: invalid.error });
    if (!["textbook", "teacher_guide", "worksheet", "digital", "other"].includes(materialType)) return res.status(400).json({ message: "Invalid learning material type." });
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ message: "Use a valid HTTP or HTTPS material link." });
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const valid = await client.query(`SELECT 1
            FROM curriculum_versions v JOIN curriculum_sources src ON src.id = v.source_id
            WHERE v.id = $1 AND v.status = 'active' AND src.verification_status = 'verified'
                AND EXISTS (SELECT 1 FROM education_levels WHERE id = $2)
                AND ($3::bigint IS NULL OR EXISTS (SELECT 1 FROM grades WHERE id = $3 AND education_level_id = $2))
                AND ($4::bigint IS NULL OR EXISTS (SELECT 1 FROM programs WHERE id = $4))
                AND ($5::bigint IS NULL OR EXISTS (SELECT 1 FROM curriculum_subjects WHERE id = $5 AND curriculum_version_id = $1 AND education_level_id = $2))
                AND ($6::bigint IS NULL OR EXISTS (SELECT 1 FROM admin_schools WHERE id = $6 AND status = 'active'))`, [versionId, educationLevelId, gradeId, programId, subjectId, schoolId]);
        if (!valid.rows[0]) {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "Select an active verified source and matching curriculum, class, program and school." });
        }
        const created = await client.query(`INSERT INTO curriculum_materials
            (curriculum_version_id, education_level_id, grade_id, program_id, subject_id, material_type, title, publisher, edition, url, source_reference, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'published')
            RETURNING id, title, material_type, status`, [versionId, educationLevelId, gradeId, programId, subjectId, materialType, title, publisher, edition, url, sourceReference]);
        if (schoolId) await client.query("INSERT INTO school_textbook_assignments (school_id, material_id, assigned_by) VALUES ($1, $2, $3)", [schoolId, created.rows[0].id, req.auth.userId]);
        await client.query("INSERT INTO admin_audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)", [req.auth.userId, "curriculum.material_published", "curriculum_material", String(created.rows[0].id), JSON.stringify({ schoolId, materialType })]);
        await client.query("COMMIT");
        return res.status(201).json({ data: created.rows[0] });
    } catch (error) {
        try { await client.query("ROLLBACK"); }
        catch (rollbackError) { console.error("ADMIN CURRICULUM MATERIAL ROLLBACK ERROR:", rollbackError); }
        console.error("ADMIN CURRICULUM MATERIAL CREATE ERROR:", error);
        return res.status(500).json({ message: "Curriculum material could not be published." });
    } finally {
        client.release();
    }
});

router.post("/tvet-subjects", async (req, res) => {
    const programId = positiveInteger(req.body.programId, "TVET program");
    const gradeId = positiveInteger(req.body.gradeId, "TVET level");
    const versionId = positiveInteger(req.body.curriculumVersionId, "Curriculum version");
    const code = text(req.body.code, "TVET subject code", true, 100);
    const name = text(req.body.name, "TVET subject name", true, 200);
    const description = text(req.body.description, "Description", false, 2000);
    const sourceReference = text(req.body.sourceReference, "Source reference", true, 2000);
    try {
        const valid = await pool.query(`SELECT 1 FROM programs p
            JOIN tvet_program_levels tpl ON tpl.program_id = p.id AND tpl.grade_id = $2
            JOIN curriculum_versions v ON v.id = $3 AND v.status = 'active'
            JOIN curriculum_sources src ON src.id = v.source_id AND src.verification_status = 'verified'
            JOIN grades g ON g.id = $2 AND g.code IN ('L3', 'L4', 'L5')
            WHERE p.id = $1 AND p.curriculum_verification_status = 'verified'`, [programId, gradeId, versionId]);
        if (!valid.rows[0]) return res.status(400).json({ message: "Choose an officially verified TVET program, level and active curriculum version." });
        const result = await pool.query(`INSERT INTO tvet_subjects (program_id, grade_id, curriculum_version_id, code, name, description, source_reference)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, program_id, grade_id, curriculum_version_id, code, name, description, source_reference, status`, [programId, gradeId, versionId, code, name, description, sourceReference]);
        await audit(req, "curriculum.tvet_subject_created", "tvet_subject", result.rows[0].id);
        res.status(201).json({ data: result.rows[0] });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "That TVET subject code already exists for the selected program." });
        console.error("ADMIN TVET SUBJECT CREATE ERROR:", error);
        res.status(500).json({ message: "TVET subject could not be created." });
    }
});

router.post("/tvet-subjects/:id/competences", async (req, res) => {
    const subjectId = positiveInteger(req.params.id, "TVET subject");
    const code = text(req.body.code, "Competence code", true, 100);
    const title = text(req.body.title, "Competence title", true, 240);
    const description = text(req.body.description, "Description", false, 2000);
    try {
        const result = await pool.query(`INSERT INTO tvet_competences (subject_id, code, title, description)
            SELECT $1, $2, $3, $4 WHERE EXISTS (
                SELECT 1 FROM tvet_subjects s JOIN curriculum_versions v ON v.id = s.curriculum_version_id AND v.status = 'active'
                JOIN curriculum_sources src ON src.id = v.source_id AND src.verification_status = 'verified'
                WHERE s.id = $1 AND s.status <> 'retired'
            ) RETURNING id, subject_id, code, title, description, position, status`, [subjectId, code, title, description]);
        if (!result.rows[0]) return res.status(400).json({ message: "Choose a non-retired TVET subject with an active verified source." });
        await audit(req, "curriculum.tvet_competence_created", "tvet_competence", result.rows[0].id);
        res.status(201).json({ data: result.rows[0] });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "That competence code already exists for this subject." });
        console.error("ADMIN TVET COMPETENCE CREATE ERROR:", error);
        res.status(500).json({ message: "TVET competence could not be created." });
    }
});

router.post("/tvet-competences/:id/modules", async (req, res) => {
    const competenceId = positiveInteger(req.params.id, "TVET competence");
    const title = text(req.body.title, "Module title", true, 240);
    const description = text(req.body.description, "Description", false, 2000);
    const position = Number(req.body.position);
    if (!Number.isInteger(position) || position < 1) return res.status(400).json({ message: "Module position must be a positive integer." });
    try {
        const result = await pool.query(`INSERT INTO tvet_modules (competence_id, title, description, position)
            SELECT $1, $2, $3, $4 WHERE EXISTS (
                SELECT 1 FROM tvet_competences c JOIN tvet_subjects s ON s.id = c.subject_id
                JOIN curriculum_versions v ON v.id = s.curriculum_version_id AND v.status = 'active'
                JOIN curriculum_sources src ON src.id = v.source_id AND src.verification_status = 'verified'
                WHERE c.id = $1 AND c.status <> 'retired' AND s.status <> 'retired'
            ) RETURNING id, competence_id, title, description, position, status`, [competenceId, title, description, position]);
        if (!result.rows[0]) return res.status(400).json({ message: "Choose a competence in a non-retired, source-verified subject." });
        await audit(req, "curriculum.tvet_module_created", "tvet_module", result.rows[0].id);
        res.status(201).json({ data: result.rows[0] });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "That module position is already used by this competence." });
        console.error("ADMIN TVET MODULE CREATE ERROR:", error);
        res.status(500).json({ message: "TVET module could not be created." });
    }
});

router.post("/tvet-modules/:id/units", async (req, res) => {
    const moduleId = positiveInteger(req.params.id, "TVET module");
    const title = text(req.body.title, "Unit title", true, 240);
    const description = text(req.body.description, "Description", false, 2000);
    const position = Number(req.body.position);
    if (!Number.isInteger(position) || position < 1) return res.status(400).json({ message: "Unit position must be a positive integer." });
    try {
        const result = await pool.query(`INSERT INTO tvet_units (module_id, title, description, position)
            SELECT $1, $2, $3, $4 WHERE EXISTS (
                SELECT 1 FROM tvet_modules m JOIN tvet_competences c ON c.id = m.competence_id
                JOIN tvet_subjects s ON s.id = c.subject_id JOIN curriculum_versions v ON v.id = s.curriculum_version_id AND v.status = 'active'
                JOIN curriculum_sources src ON src.id = v.source_id AND src.verification_status = 'verified'
                WHERE m.id = $1 AND m.status <> 'retired' AND c.status <> 'retired' AND s.status <> 'retired'
            ) RETURNING id, module_id, title, description, position, status`, [moduleId, title, description, position]);
        if (!result.rows[0]) return res.status(400).json({ message: "Choose a module in a non-retired, source-verified subject." });
        await audit(req, "curriculum.tvet_unit_created", "tvet_unit", result.rows[0].id);
        res.status(201).json({ data: result.rows[0] });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "That unit position is already used by this module." });
        console.error("ADMIN TVET UNIT CREATE ERROR:", error);
        res.status(500).json({ message: "TVET unit could not be created." });
    }
});

router.post("/tvet-units/:id/outcomes", async (req, res) => {
    const unitId = positiveInteger(req.params.id, "TVET unit");
    const code = text(req.body.code, "Outcome code", true, 100);
    const description = text(req.body.description, "Learning outcome", true, 4000);
    const sourceReference = text(req.body.sourceReference, "Source reference", true, 2000);
    const position = Number(req.body.position);
    if (!Number.isInteger(position) || position < 1) return res.status(400).json({ message: "Outcome position must be a positive integer." });
    try {
        const result = await pool.query(`INSERT INTO tvet_learning_outcomes (unit_id, code, description, position, source_reference)
            SELECT $1, $2, $3, $4, $5 WHERE EXISTS (
                SELECT 1 FROM tvet_units u JOIN tvet_modules m ON m.id = u.module_id
                JOIN tvet_competences c ON c.id = m.competence_id JOIN tvet_subjects s ON s.id = c.subject_id
                JOIN curriculum_versions v ON v.id = s.curriculum_version_id AND v.status = 'active'
                JOIN curriculum_sources src ON src.id = v.source_id AND src.verification_status = 'verified'
                WHERE u.id = $1 AND u.status <> 'retired'
            ) RETURNING id, unit_id, code, description, position, status`, [unitId, code, description, position, sourceReference]);
        if (!result.rows[0]) return res.status(400).json({ message: "Choose a unit in a source-verified TVET curriculum." });
        await audit(req, "curriculum.tvet_outcome_created", "tvet_learning_outcome", result.rows[0].id);
        res.status(201).json({ data: result.rows[0] });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "That learning outcome code already exists for this unit." });
        console.error("ADMIN TVET OUTCOME CREATE ERROR:", error);
        res.status(500).json({ message: "TVET learning outcome could not be created." });
    }
});

router.patch("/tvet-curriculum/:type/:id/status", async (req, res) => {
    const config = {
        subjects: { table: "tvet_subjects", entity: "tvet_subject" },
        competences: { table: "tvet_competences", entity: "tvet_competence" },
        modules: { table: "tvet_modules", entity: "tvet_module" },
        units: { table: "tvet_units", entity: "tvet_unit" },
        outcomes: { table: "tvet_learning_outcomes", entity: "tvet_learning_outcome" },
    }[req.params.type];
    const id = positiveInteger(req.params.id, "TVET curriculum record");
    const status = text(req.body.status);
    if (!config || !["draft", "published", "retired"].includes(status)) return res.status(400).json({ message: "Invalid TVET curriculum type or status." });
    try {
        const result = await pool.query(`UPDATE ${config.table} SET status = $1 WHERE id = $2 RETURNING id, status`, [status, id]);
        if (!result.rows[0]) return res.status(404).json({ message: "TVET curriculum record not found." });
        await audit(req, "curriculum.tvet_status_changed", config.entity, id, { status });
        res.json({ data: result.rows[0] });
    } catch (error) { console.error("ADMIN TVET CURRICULUM STATUS ERROR:", error); res.status(500).json({ message: "TVET curriculum status could not be changed." }); }
});

router.post("/curriculum-enrollments", async (req, res) => {
    const studentId = positiveInteger(req.body.studentId, "Student");
    const subjectId = positiveInteger(req.body.curriculumSubjectId, "Curriculum subject");
    try {
        const match = await pool.query(`SELECT 1 FROM users u
            JOIN curriculum_subjects cs ON cs.id = $2 AND cs.education_level_id = u.education_level_id
            JOIN curriculum_versions v ON v.id = cs.curriculum_version_id AND v.status = 'active'
            JOIN curriculum_sources src ON src.id = v.source_id AND src.verification_status = 'verified'
            WHERE u.id = $1 AND u.role = 'student' AND u.status = 'active'
                AND (cs.grade_id IS NULL OR cs.grade_id = u.grade_id)
                AND (cs.program_id IS NULL OR cs.program_id = u.program_id)
                AND (cs.combination_id IS NULL OR cs.combination_id = u.subject_combination_id)`, [studentId, subjectId]);
        if (!match.rows[0]) return res.status(400).json({ message: "This student profile does not match an active, verified subject mapping." });
        const result = await pool.query(`INSERT INTO student_curriculum_enrollments (student_id, curriculum_subject_id, enrolled_by, status)
            VALUES ($1, $2, $3, 'active') ON CONFLICT (student_id, curriculum_subject_id)
            DO UPDATE SET enrolled_by = EXCLUDED.enrolled_by, status = 'active', enrolled_at = now()
            RETURNING student_id, curriculum_subject_id, status, enrolled_at`, [studentId, subjectId, req.auth.userId]);
        await audit(req, "curriculum.student_enrolled", "student_curriculum_enrollment", studentId, { curriculumSubjectId: subjectId });
        res.status(201).json({ data: result.rows[0] });
    } catch (error) { console.error("ADMIN CURRICULUM ENROLLMENT ERROR:", error); res.status(500).json({ message: "Student subject enrollment could not be saved." }); }
});

router.get("/users", async (req, res) => {
    const search = text(req.query.search).slice(0, 120);
    const role = ["student", "teacher", "admin", "super-admin"].includes(req.query.role) ? req.query.role : null;
    const status = ["active", "pending", "suspended"].includes(req.query.status) ? req.query.status : null;
    try {
        const result = await pool.query(`SELECT u.id, u.name AS full_name, u.email, u.role, u.status, u.created_at,
                u.school_id, school.name AS school_name, u.education_level_id, level.name AS education_level_name,
                u.grade_id, grade.name AS grade_name, u.program_id, program.name AS program_name,
                NULL::timestamptz AS last_login_at
            FROM users u LEFT JOIN admin_schools school ON school.id = u.school_id
            LEFT JOIN education_levels level ON level.id = u.education_level_id
            LEFT JOIN grades grade ON grade.id = u.grade_id
            LEFT JOIN programs program ON program.id = u.program_id
            WHERE ($1 = '' OR u.name ILIKE $2 OR u.email ILIKE $2)
                AND ($3::text IS NULL OR u.role = $3) AND ($4::text IS NULL OR u.status = $4)
            ORDER BY u.created_at DESC LIMIT 500`, [search, `%${search}%`, role, status]);
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN USERS ERROR:", error.message); res.status(500).json({ message: "Users are temporarily unavailable." }); }
});

router.patch("/users/:id/status", async (req, res) => {
    const userId = positiveInteger(req.params.id, "User ID");
    const nextStatus = text(req.body.status);
    if (!["active", "pending", "suspended"].includes(nextStatus)) return res.status(400).json({ message: "Invalid user status." });
    if (String(userId) === String(req.auth.userId)) return res.status(400).json({ message: "You cannot change your own account status." });
    try {
        const result = await pool.query("UPDATE users SET status = $1 WHERE id = $2 AND role = 'student' RETURNING id, name AS full_name, email, role, status", [nextStatus, userId]);
        if (!result.rows[0]) return res.status(404).json({ message: "Student not found." });
        await audit(req, "user.status_changed", "user", userId, { status: nextStatus });
        res.json({ data: result.rows[0] });
    } catch (error) { console.error("ADMIN USER STATUS ERROR:", error.message); res.status(500).json({ message: "User status could not be updated." }); }
});

router.get("/teachers", async (_req, res) => {
    try {
        const result = await pool.query(`SELECT u.id, u.name AS full_name, u.email, u.status, u.created_at, u.teacher_verification_status, u.bio,
            u.school_id, school.name AS school_name,
            COALESCE(string_agg(DISTINCT s.name, ', ' ORDER BY s.name), '') AS subjects,
            count(DISTINCT c.id)::int AS courses,
            COALESCE(array_agg(DISTINCT tp.permission) FILTER (WHERE tp.permission IS NOT NULL), '{}') AS permissions
            FROM users u LEFT JOIN admin_schools school ON school.id = u.school_id
            LEFT JOIN library_courses c ON c.teacher_id = u.id LEFT JOIN library_subjects s ON s.id = c.subject_id
            LEFT JOIN teacher_permissions tp ON tp.teacher_id = u.id WHERE u.role = 'teacher'
            GROUP BY u.id, school.name ORDER BY u.name`);
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN TEACHERS ERROR:", error.message); res.status(500).json({ message: "Teachers are temporarily unavailable." }); }
});

router.get("/review", async (_req, res) => {
    try {
        const result = await pool.query(`SELECT c.id, 'course' AS content_type, c.title, c.status, c.updated_at AS created_at, u.name AS teacher, s.name AS subject, g.name AS class_name, p.name AS program
            FROM library_courses c LEFT JOIN users u ON u.id = c.teacher_id JOIN library_subjects s ON s.id = c.subject_id
            LEFT JOIN grades g ON g.id = c.grade_id LEFT JOIN programs p ON p.id = c.program_id WHERE c.status = 'pending'
            UNION ALL SELECT l.id, 'lesson', l.title, l.status, now(), u.name, s.name, g.name, p.name
            FROM course_lessons l JOIN course_modules m ON m.id = l.module_id JOIN library_courses c ON c.id = m.course_id
            LEFT JOIN users u ON u.id = c.teacher_id JOIN library_subjects s ON s.id = c.subject_id LEFT JOIN grades g ON g.id = c.grade_id LEFT JOIN programs p ON p.id = c.program_id WHERE l.status = 'pending'
            ORDER BY created_at DESC`);
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN REVIEW ERROR:", error.message); res.status(500).json({ message: "Review queue is temporarily unavailable." }); }
});

router.post("/teachers", async (req, res) => {
    const email = text(req.body.email, "Email", true, 255).toLowerCase();
    const name = text(req.body.fullName, "Full name", true, 120);
    const bio = text(req.body.bio, "Bio", false, 4000);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid teacher email." });
    try {
        const temporaryPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 12);
        const result = await pool.query("INSERT INTO users (name,email,password_hash,role,status,email_verified_at,bio,teacher_verification_status) VALUES ($1,$2,$3,'teacher','pending',NULL,$4,'pending') RETURNING id,name AS full_name,email,role,status,created_at,teacher_verification_status", [name, email, temporaryPasswordHash, bio]);
        await audit(req, "teacher.created", "teacher", result.rows[0].id, { email });
        res.status(201).json({ data: result.rows[0] });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "An account with that email already exists." });
        console.error("ADMIN TEACHER CREATE ERROR:", error.message);
        res.status(500).json({ message: "Teacher could not be created." });
    }
});

router.get("/audit-logs", async (_req, res) => {
    try {
        const result = await pool.query("SELECT id, actor_id, action, entity_type, entity_id, metadata, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 200");
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN AUDIT ERROR:", error.message); res.status(500).json({ message: "Audit logs are temporarily unavailable." }); }
});

router.get("/schools", async (req, res) => {
    const search = text(req.query.search).slice(0, 120);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    try {
        const pattern = `%${search}%`;
        const [rows, count] = await Promise.all([
            pool.query("SELECT id, name, location, phone, email, status, created_at FROM admin_schools WHERE ($1 = '' OR name ILIKE $2 OR location ILIKE $2 OR email ILIKE $2) ORDER BY created_at DESC LIMIT $3 OFFSET $4", [search, pattern, limit, offset]),
            pool.query("SELECT count(*)::int AS total FROM admin_schools WHERE ($1 = '' OR name ILIKE $2 OR location ILIKE $2 OR email ILIKE $2)", [search, pattern]),
        ]);
        res.json({ data: rows.rows, meta: { total: count.rows[0].total, limit, offset } });
    } catch (error) { console.error("ADMIN SCHOOLS ERROR:", error.message); res.status(500).json({ message: "Schools are temporarily unavailable. Apply the legacy admin dashboard migration if it has not been run." }); }
});

router.post("/schools", async (req, res) => {
    const name = text(req.body.name, "School name", true, 160);
    const location = text(req.body.location, "Location", false, 240);
    const phone = text(req.body.phone, "Phone", false, 40);
    const email = text(req.body.email, "Email", true, 255).toLowerCase();
    const status = ["active", "inactive", "pending"].includes(req.body.status) ? req.body.status : "pending";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid school email." });
    try {
        const result = await pool.query("INSERT INTO admin_schools (name, location, phone, email, status, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, location, phone, email, status, created_at", [name, location, phone, email, status, req.auth.userId]);
        await audit(req, "school.created", "school", result.rows[0].id);
        res.status(201).json({ data: result.rows[0] });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "A school with that email already exists." });
        console.error("ADMIN SCHOOL CREATE ERROR:", error.message); res.status(500).json({ message: "School could not be created." });
    }
});

router.patch("/schools/:id", async (req, res) => {
    const schoolId = positiveInteger(req.params.id, "School ID");
    const allowed = { name: "name", location: "location", phone: "phone", email: "email", status: "status" };
    const columns = Object.entries(allowed).filter(([key]) => Object.hasOwn(req.body, key));
    if (!columns.length) return res.status(400).json({ message: "Provide at least one field to update." });
    const values = [];
    const assignments = columns.map(([key, column]) => {
        let value = req.body[key];
        if (key === "name") value = text(value, "School name", true, 160);
        else if (key === "location") value = text(value, "Location", false, 240);
        else if (key === "phone") value = text(value, "Phone", false, 40);
        else if (key === "email") {
            value = text(value, "Email", true, 255).toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw httpError(400, "Enter a valid school email.");
        } else if (!["active", "inactive", "pending"].includes(value)) throw httpError(400, "Invalid school status.");
        values.push(value);
        return `${column} = $${values.length}`;
    });
    values.push(schoolId);
    try {
        const result = await pool.query(`UPDATE admin_schools SET ${assignments.join(", ")}, updated_at = now() WHERE id = $${values.length} RETURNING id, name, location, phone, email, status, created_at`, values);
        if (!result.rows[0]) return res.status(404).json({ message: "School not found." });
        await audit(req, "school.updated", "school", schoolId);
        res.json({ data: result.rows[0] });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "A school with that email already exists." });
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error("ADMIN SCHOOL UPDATE ERROR:", error.message); res.status(500).json({ message: "School could not be updated." });
    }
});

router.delete("/schools/:id", async (req, res) => {
    const schoolId = positiveInteger(req.params.id, "School ID");
    try {
        const result = await pool.query("DELETE FROM admin_schools WHERE id = $1 RETURNING id", [schoolId]);
        if (!result.rows[0]) return res.status(404).json({ message: "School not found." });
        await audit(req, "school.deleted", "school", schoolId);
        res.status(204).send();
    } catch (error) { console.error("ADMIN SCHOOL DELETE ERROR:", error.message); res.status(500).json({ message: "School could not be deleted." }); }
});

router.get("/results", async (_req, res) => {
    try {
        const result = await pool.query(`SELECT a.id, u.name AS student, a.student_id, c.title AS course, q.title AS assessment, 'Quiz' AS assessment_type, a.score::numeric AS score, 100::numeric AS total, a.submitted_at
            FROM library_quiz_attempts a
            JOIN users u ON u.id = a.student_id AND u.role = 'student'
            JOIN library_quizzes q ON q.id = a.quiz_id
            JOIN library_courses c ON c.id = q.course_id
            ORDER BY a.submitted_at DESC LIMIT 500`);
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN RESULTS ERROR:", error.message); res.status(500).json({ message: "Results are temporarily unavailable." }); }
});

router.get("/activities", async (_req, res) => {
    try {
        const result = await pool.query("SELECT l.id, l.actor_id, u.name AS actor, l.action, l.entity_type, l.entity_id, l.metadata, l.created_at FROM admin_audit_logs l LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.created_at DESC LIMIT 100");
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN ACTIVITIES ERROR:", error.message); res.status(500).json({ message: "Activity history is temporarily unavailable." }); }
});

router.get("/notifications", async (req, res) => {
    try {
        const result = await pool.query("SELECT id, title, body, read_at, created_at FROM admin_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50", [req.auth.userId]);
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN NOTIFICATIONS ERROR:", error.message); res.status(500).json({ message: "Notifications are temporarily unavailable. Apply the legacy admin dashboard migration if it has not been run." }); }
});

router.patch("/notifications/read", async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map((value) => positiveInteger(value, "Notification ID")) : [];
    const all = req.body.all === true;
    if (!all && !ids.length) return res.status(400).json({ message: "Provide notification IDs or set all to true." });
    if (ids.length > 100) return res.status(400).json({ message: "At most 100 notification IDs can be updated at once." });
    try {
        const result = all
            ? await pool.query("UPDATE admin_notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL RETURNING id", [req.auth.userId])
            : await pool.query("UPDATE admin_notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL RETURNING id", [req.auth.userId, ids]);
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN NOTIFICATION READ ERROR:", error.message); res.status(500).json({ message: "Notifications could not be marked as read." }); }
});

router.get("/classes", async (_req, res) => {
    try {
        const result = await pool.query(`SELECT s.id, s.course_id, c.title, s.teacher_id, u.name AS teacher, s.starts_at, s.ends_at, s.room
            FROM admin_class_schedule s JOIN library_courses c ON c.id = s.course_id JOIN users u ON u.id = s.teacher_id
            WHERE s.starts_at >= now() ORDER BY s.starts_at LIMIT 100`);
        res.json({ data: result.rows });
    } catch (error) { console.error("ADMIN CLASS SCHEDULE ERROR:", error.message); res.status(500).json({ message: "Class schedules are temporarily unavailable. Apply the legacy admin dashboard migration if it has not been run." }); }
});

router.post("/classes", async (req, res) => {
    const courseId = positiveInteger(req.body.courseId, "Course ID");
    const startsAt = new Date(req.body.startsAt);
    const endsAt = new Date(req.body.endsAt);
    const room = text(req.body.room, "Room", false, 160);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) return res.status(400).json({ message: "Choose valid class start and end times." });
    try {
        const course = await pool.query("SELECT c.teacher_id FROM library_courses c JOIN users u ON u.id = c.teacher_id AND u.role = 'teacher' AND u.status = 'active' WHERE c.id = $1", [courseId]);
        if (!course.rows[0]) return res.status(404).json({ message: "Course or active teacher not found." });
        const result = await pool.query("INSERT INTO admin_class_schedule (course_id, teacher_id, starts_at, ends_at, room, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, course_id, teacher_id, starts_at, ends_at, room", [courseId, course.rows[0].teacher_id, startsAt, endsAt, room, req.auth.userId]);
        await audit(req, "class.scheduled", "class", result.rows[0].id);
        res.status(201).json({ data: result.rows[0] });
    } catch (error) { console.error("ADMIN CLASS CREATE ERROR:", error.message); res.status(500).json({ message: "Class could not be scheduled." }); }
});

router.get("/content/:type", async (req, res) => {
    const type = req.params.type;
    const query = listQueries[type];
    if (!query) return res.status(400).json({ message: "Unsupported content type." });
    const search = text(req.query.search).slice(0, 120);
    const levelId = optionalInteger(req.query.level);
    const gradeId = optionalInteger(req.query.grade);
    const programNone = req.query.program === "none";
    const programId = req.query.program === undefined ? null : programNone ? 0 : optionalInteger(req.query.program);
    const subjectId = optionalInteger(req.query.subject);
    try {
        const programColumn = type === "subjects" ? "s.program_id" : "c.program_id";
        const programCondition = `($5::bigint IS NULL OR ${programColumn} IS NOT DISTINCT FROM $5::bigint)`;
        const filteredQuery = programNone && ["subjects", "courses", "modules", "lessons", "notes", "examples", "exercises", "assignments", "quizzes", "tests", "exams"].includes(type)
            ? query.replace(programCondition, `($5::bigint IS NULL OR ($5 = 0 AND ${programColumn} IS NULL) OR ($5 > 0 AND ${programColumn} = $5))`)
            : query;
        const values = [search || null, `%${search}%`, levelId, gradeId, programId, subjectId].slice(0, listParameterCounts[type]);
        const count = await pool.query(`SELECT count(*)::int AS total FROM (${filteredQuery}) AS filtered_content`, values);
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
        const offset = Math.max(0, Number(req.query.offset) || 0);
        const result = await pool.query(`${filteredQuery} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]);
        res.json({ data: result.rows, meta: { total: count.rows[0].total, limit, offset } });
    } catch (error) { console.error("ADMIN CONTENT LIST ERROR:", error.message); res.status(500).json({ message: "Content is temporarily unavailable." }); }
});

router.post("/content/:type", async (req, res) => {
    const type = req.params.type;
    const body = req.body || {};
    let result;
    try {
        if (type === "levels") result = await pool.query("INSERT INTO education_levels (name, code, category, position) VALUES ($1, $2, $3, $4) RETURNING *", [text(body.name, "Name", true, 120), text(body.code, "Code", true, 40).toUpperCase(), text(body.category, "Category") || "CUSTOM", Number(body.position) || 0]);
        else if (type === "grades") {
            const levelId = positiveInteger(body.educationLevelId, "Education level");
            const level = await pool.query("SELECT 1 FROM education_levels WHERE id = $1", [levelId]);
            if (!level.rows[0]) throw httpError(400, "Education level does not exist.");
            result = await pool.query("INSERT INTO grades (education_level_id, name, code, position) VALUES ($1, $2, $3, $4) RETURNING *", [levelId, text(body.name, "Name", true, 120), text(body.code, "Code", true, 40).toUpperCase(), Number(body.position) || 0]);
        } else if (type === "programs") result = await pool.query("INSERT INTO programs (department_id, name, description) VALUES ($1, $2, $3) RETURNING *", [optionalInteger(body.departmentId), text(body.name, "Name", true, 160), text(body.description, "Description")]);
        else if (type === "subjects") {
            const target = await targetFrom(body, false);
            result = await pool.query("INSERT INTO library_subjects (name, description, education_level_id, grade_id, program_id, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *", [text(body.name, "Name", true, 160), text(body.description, "Description"), target.educationLevelId, target.gradeId, target.programId, req.auth.userId]);
        } else if (type === "courses") {
            const target = await targetFrom(body, true);
            const teacherId = optionalInteger(body.teacherId);
            if (teacherId) {
                const teacher = await pool.query("SELECT 1 FROM users WHERE id = $1 AND role = 'teacher'", [teacherId]);
                if (!teacher.rows[0]) throw httpError(400, "Choose an existing teacher account.");
            }
            result = await pool.query("INSERT INTO library_courses (subject_id, education_level_id, grade_id, program_id, teacher_id, title, description, difficulty, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft') RETURNING *", [target.subjectId, target.educationLevelId, target.gradeId, target.programId, teacherId, text(body.title, "Title", true, 240), text(body.description, "Description"), text(body.difficulty, "Difficulty") || "Beginner"]);
        } else if (["modules", "lessons", "notes", "examples", "exercises", "assignments", "quizzes", "tests", "exams"].includes(type)) {
            const target = await targetFrom(body, true);
            if (type === "modules") {
                const courseId = positiveInteger(body.courseId, "Course"); await assertCourseTarget(courseId, target);
                result = await pool.query("INSERT INTO course_modules (course_id, title, position, status) VALUES ($1,$2,$3,'draft') RETURNING *", [courseId, text(body.title, "Title", true, 240), Number(body.position) || 0]);
            } else if (type === "lessons") {
                const moduleId = positiveInteger(body.moduleId, "Module"); const courseId = await ownedCourseFor("modules", moduleId); await assertCourseTarget(courseId, target);
                result = await pool.query("INSERT INTO course_lessons (module_id, title, explanation, key_points, definitions, summary, position, language, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft') RETURNING *", [moduleId, text(body.title, "Title", true, 240), text(body.body || body.explanation, "Lesson content"), JSON.stringify(Array.isArray(body.keyPoints) ? body.keyPoints : []), JSON.stringify(Array.isArray(body.definitions) ? body.definitions : []), text(body.summary), Number(body.position) || 0, text(body.language) || "English"]);
            } else if (["notes", "examples", "exercises"].includes(type)) {
                const lessonId = positiveInteger(body.lessonId, "Lesson"); const courseId = await ownedCourseFor("lessons", lessonId); await assertCourseTarget(courseId, target);
                if (type === "notes") result = await pool.query("INSERT INTO lesson_notes (lesson_id,title,body,position,status) VALUES ($1,$2,$3,$4,'draft') RETURNING *", [lessonId, text(body.title, "Title", true, 240), text(body.body, "Body", true), Number(body.position) || 0]);
                else if (type === "examples") result = await pool.query("INSERT INTO lesson_examples (lesson_id,title,body,position,status) VALUES ($1,$2,$3,$4,'draft') RETURNING *", [lessonId, text(body.title, "Title", true, 240), text(body.body, "Body", true), Number(body.position) || 0]);
                else result = await pool.query("INSERT INTO lesson_exercises (lesson_id,prompt,answer,position,status) VALUES ($1,$2,$3,$4,'draft') RETURNING *", [lessonId, text(body.prompt, "Prompt", true), text(body.answer, "Answer"), Number(body.position) || 0]);
            } else if (type === "quizzes") {
                const courseId = positiveInteger(body.courseId, "Course"); await assertCourseTarget(courseId, target);
                result = await pool.query("INSERT INTO library_quizzes (course_id,lesson_id,title,published,status) VALUES ($1,$2,$3,false,'draft') RETURNING *", [courseId, optionalInteger(body.lessonId), text(body.title, "Title", true, 240)]);
            } else {
                const courseId = positiveInteger(body.courseId, "Course"); await assertCourseTarget(courseId, target);
                const kind = type === "assignments" ? "homework" : type === "tests" ? "test" : "exam";
                result = await pool.query("INSERT INTO library_assessments (kind,course_id,title,instructions,due_at,total_marks,time_limit_seconds,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft') RETURNING *", [kind, courseId, text(body.title, "Title", true, 240), text(body.instructions, "Instructions"), body.dueAt ? new Date(body.dueAt) : null, Number(body.totalMarks) || 100, optionalInteger(body.timeLimitSeconds)]);
            }
        } else throw httpError(400, "Unsupported content type.");
        await audit(req, "content.created", type, result.rows[0].id, { target: body.educationLevelId ? body : undefined });
        res.status(201).json({ data: result.rows[0] });
    } catch (error) { if (error.status) return res.status(error.status).json({ message: error.message }); console.error("ADMIN CONTENT CREATE ERROR:", error.message); res.status(500).json({ message: "Content could not be created." }); }
});

router.patch("/content/:type/:id", async (req, res) => {
    const type = req.params.type; const id = optionalInteger(req.params.id); const body = req.body || {};
    if (!id || !contentTypes.has(type)) return res.status(400).json({ message: "Invalid content type or id." });
    const tables = { levels: "education_levels", grades: "grades", programs: "programs", subjects: "library_subjects", courses: "library_courses", modules: "course_modules", lessons: "course_lessons", notes: "lesson_notes", examples: "lesson_examples", exercises: "lesson_exercises", assignments: "library_assessments", quizzes: "library_quizzes", tests: "library_assessments", exams: "library_assessments" };
    const fieldsByType = {
        levels: { name: "name", code: "code", category: "category", position: "position" },
        grades: { name: "name", code: "code", position: "position" },
        programs: { name: "name", description: "description", departmentId: "department_id" },
        subjects: { name: "name", description: "description" },
        courses: { title: "title", description: "description", difficulty: "difficulty", teacherId: "teacher_id" },
        modules: { title: "title", position: "position" },
        lessons: { title: "title", body: "explanation", explanation: "explanation", summary: "summary", language: "language", position: "position" },
        notes: { title: "title", body: "body", position: "position" },
        examples: { title: "title", body: "body", position: "position" },
        exercises: { prompt: "prompt", answer: "answer", position: "position" },
        assignments: { title: "title", instructions: "instructions", dueAt: "due_at", totalMarks: "total_marks" },
        quizzes: { title: "title", lessonId: "lesson_id" },
        tests: { title: "title", instructions: "instructions", timeLimitSeconds: "time_limit_seconds" },
        exams: { title: "title", timeLimitSeconds: "time_limit_seconds" },
    };
    try {
        if (type === "courses" && ["educationLevelId", "gradeId", "programId", "subjectId"].some((key) => key in body)) {
            const current = await pool.query("SELECT education_level_id, grade_id, program_id, subject_id FROM library_courses WHERE id = $1", [id]);
            if (!current.rows[0]) return res.status(404).json({ message: "Content not found." });
            const merged = { educationLevelId: body.educationLevelId ?? current.rows[0].education_level_id, gradeId: body.gradeId ?? current.rows[0].grade_id, programId: body.programId === undefined ? current.rows[0].program_id : body.programId, subjectId: body.subjectId ?? current.rows[0].subject_id };
            await targetFrom(merged, true);
            await pool.query("UPDATE library_courses SET education_level_id=$1, grade_id=$2, program_id=$3, subject_id=$4, updated_at=now() WHERE id=$5", [merged.educationLevelId, merged.gradeId, merged.programId, merged.subjectId, id]);
        }
        const allowed = fieldsByType[type]; const assignments = []; const values = [];
        for (const [key, column] of Object.entries(allowed)) {
            if (!(key in body)) continue;
            let value = body[key];
            if (["teacherId", "departmentId", "lessonId"].includes(key)) value = optionalInteger(value);
            if (key === "dueAt" && value) value = new Date(value);
            if (typeof value === "string" && value.length > 10000) throw httpError(400, "Field value is too long.");
            assignments.push(`${column} = $${values.length + 1}`); values.push(value);
        }
        if (type === "assignments" || type === "tests" || type === "exams") {
            if (!assignments.length) throw httpError(400, "No editable fields supplied.");
            const kind = type === "assignments" ? "homework" : type === "tests" ? "test" : "exam";
            if (assignments.length) assignments.push(`updated_at=now()`);
            const result = await pool.query(`UPDATE library_assessments SET ${assignments.join(", ")} WHERE id=$${values.length + 2} AND kind=$${values.length + 1} RETURNING *`, [...values, kind, id]);
            if (!result.rows[0]) return res.status(404).json({ message: "Content not found." });
            await audit(req, "content.updated", type, id, { fields: Object.keys(body) });
            return res.json({ data: result.rows[0] });
        }
        if ("status" in body && !["levels", "grades", "programs", "subjects"].includes(type)) { assignments.push(`status=$${values.length + 1}`); values.push(statusValue(body.status)); }
        if (!assignments.length) throw httpError(400, "No editable fields supplied.");
        if (type === "courses") assignments.push("updated_at=now()");
        if (type === "quizzes" && body.status) { assignments.push(`published=$${values.length + 1}`); values.push(body.status === "published"); }
        values.push(id);
        const result = await pool.query(`UPDATE ${tables[type]} SET ${assignments.join(", ")} WHERE id=$${values.length} RETURNING *`, values);
        if (!result.rows[0]) return res.status(404).json({ message: "Content not found." });
        await audit(req, "content.updated", type, id, { fields: Object.keys(body) });
        res.json({ data: result.rows[0] });
    } catch (error) { if (error.status) return res.status(error.status).json({ message: error.message }); console.error("ADMIN CONTENT UPDATE ERROR:", error.message); res.status(500).json({ message: "Content could not be updated." }); }
});

router.patch("/content/:type/:id/status", async (req, res) => {
    const type = req.params.type; const id = optionalInteger(req.params.id); const nextStatus = statusValue(req.body.status);
    const statusTables = { courses: "library_courses", modules: "course_modules", lessons: "course_lessons", notes: "lesson_notes", examples: "lesson_examples", exercises: "lesson_exercises", assignments: "library_assessments", tests: "library_assessments", exams: "library_assessments", quizzes: "library_quizzes" };
    if (!statusTables[type] || !id) return res.status(400).json({ message: "Invalid content type or id." });
    try {
        const result = type === "assignments" || type === "tests" || type === "exams"
            ? await pool.query("UPDATE library_assessments SET status = $1, updated_at = now() WHERE id = $2 AND kind = $3 RETURNING *", [nextStatus, id, type === "assignments" ? "homework" : type === "tests" ? "test" : "exam"])
            : await pool.query(`UPDATE ${statusTables[type]} SET status = $1 WHERE id = $2 RETURNING *`, [nextStatus, id]);
        if (!result.rows[0]) return res.status(404).json({ message: "Content not found." });
        if (type === "quizzes") await pool.query("UPDATE library_quizzes SET published = $1 WHERE id = $2", [nextStatus === "published", id]);
        await audit(req, `content.${nextStatus}`, type, id);
        res.json({ data: result.rows[0] });
    } catch (error) { console.error("ADMIN CONTENT STATUS ERROR:", error.message); res.status(500).json({ message: "Content status could not be changed." }); }
});

router.delete("/content/:type/:id", async (req, res) => {
    const type = req.params.type; const id = optionalInteger(req.params.id);
    const tables = { levels: "education_levels", grades: "grades", programs: "programs", subjects: "library_subjects", courses: "library_courses", modules: "course_modules", lessons: "course_lessons", notes: "lesson_notes", examples: "lesson_examples", exercises: "lesson_exercises", assignments: "library_assessments", tests: "library_assessments", exams: "library_assessments", quizzes: "library_quizzes" };
    if (!tables[type] || !id) return res.status(400).json({ message: "Invalid content type or id." });
    try {
        const result = ["assignments", "tests", "exams"].includes(type)
            ? await pool.query("DELETE FROM library_assessments WHERE id = $1 AND kind = $2 RETURNING id", [id, type === "assignments" ? "homework" : type])
            : await pool.query(`DELETE FROM ${tables[type]} WHERE id = $1 RETURNING id`, [id]);
        if (!result.rows[0]) return res.status(404).json({ message: "Content not found." });
        await audit(req, "content.deleted", type, id);
        res.status(204).send();
    } catch (error) { console.error("ADMIN CONTENT DELETE ERROR:", error.message); res.status(500).json({ message: "Content could not be deleted." }); }
});

router.patch("/teachers/:id/status", async (req, res) => {
    const teacherId = optionalInteger(req.params.id); const next = text(req.body.status);
    if (!teacherId || !["pending", "approved", "verified", "suspended", "rejected"].includes(next)) return res.status(400).json({ message: "Invalid teacher or status." });
    try {
        const result = await pool.query("UPDATE users SET teacher_verification_status = $1, status = $2 WHERE id = $3 AND role = 'teacher' RETURNING id, name AS full_name, email, role, status, teacher_verification_status", [next, ["suspended", "rejected"].includes(next) ? "suspended" : "active", teacherId]);
        if (!result.rows[0]) return res.status(404).json({ message: "Teacher not found." });
        await audit(req, `teacher.${next}`, "teacher", teacherId);
        res.json({ data: result.rows[0] });
    } catch (error) { console.error("ADMIN TEACHER STATUS ERROR:", error.message); res.status(500).json({ message: "Teacher status could not be updated." }); }
});

router.put("/teachers/:id/permissions", async (req, res) => {
    const teacherId = optionalInteger(req.params.id); const permissions = Array.isArray(req.body.permissions) ? req.body.permissions.filter((value) => typeof value === "string").slice(0, 30) : null;
    if (!teacherId || !permissions) return res.status(400).json({ message: "Invalid teacher permissions." });
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const teacher = await client.query("SELECT id FROM users WHERE id = $1 AND role = 'teacher' FOR UPDATE", [teacherId]);
        if (!teacher.rows[0]) throw httpError(404, "Teacher not found.");
        await client.query("DELETE FROM teacher_permissions WHERE teacher_id = $1", [teacherId]);
        for (const permission of permissions) await client.query("INSERT INTO teacher_permissions (teacher_id, permission, granted_by) VALUES ($1,$2,$3)", [teacherId, permission.slice(0, 80), req.auth.userId]);
        await client.query("COMMIT");
        await audit(req, "teacher.permissions_changed", "teacher", teacherId, { permissions });
        res.json({ data: { teacherId, permissions } });
    } catch (error) { await client.query("ROLLBACK"); if (error.status) return res.status(error.status).json({ message: error.message }); console.error("ADMIN TEACHER PERMISSIONS ERROR:", error.message); res.status(500).json({ message: "Teacher permissions could not be saved." }); }
    finally { client.release(); }
});

router.get("/subject-notes", async (req, res) => {
    const search = text(req.query.search);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    if (!Number.isInteger(limit) || !Number.isInteger(offset) || search.length > 120) return res.status(400).json({ message: "Invalid subject note filters." });
    const pattern = search ? `%${search}%` : null;
    const from = `FROM subject_notes n
        JOIN admin_schools school ON school.id = n.school_id
        JOIN education_levels level ON level.id = n.education_level_id
        JOIN grades grade ON grade.id = n.grade_id
        JOIN library_subjects subject ON subject.id = n.subject_id
        LEFT JOIN programs program ON program.id = n.program_id
        WHERE $1::text IS NULL OR n.title ILIKE $1 OR n.topic ILIKE $1 OR n.body ILIKE $1
            OR school.name ILIKE $1 OR grade.name ILIKE $1 OR subject.name ILIKE $1 OR level.name ILIKE $1 OR program.name ILIKE $1`;
    try {
        const [rows, count] = await Promise.all([
            pool.query(`SELECT n.id, n.school_id, n.education_level_id, n.grade_id, n.program_id, n.subject_id, n.title, n.topic, n.body, n.status, n.created_at, n.updated_at,
                school.name AS school_name, level.name AS education_level_name, grade.name AS class_name, program.name AS program_name, subject.name AS subject_name,
                (SELECT COALESCE(json_agg(json_build_object('id', a.id, 'name', a.name, 'type', a.mime_type, 'size', a.size_bytes) ORDER BY a.created_at), '[]'::json)
                 FROM subject_note_attachments a WHERE a.note_id = n.id) AS attachments
                ${from} ORDER BY n.updated_at DESC LIMIT $2 OFFSET $3`, [pattern, limit, offset]),
            pool.query(`SELECT count(*)::int AS total ${from}`, [pattern]),
        ]);
        return res.json({ data: rows.rows, meta: { total: count.rows[0].total, limit, offset } });
    } catch (error) {
        console.error("ADMIN SUBJECT NOTES LIST ERROR:", error.message);
        return res.status(500).json({ message: "Subject notes could not be loaded." });
    }
});

router.post("/subject-notes", async (req, res) => {
    const body = req.body || {};
    try {
        const target = await targetFrom(body, true);
        const schoolId = positiveInteger(body.schoolId, "School");
        const school = await pool.query("SELECT id FROM admin_schools WHERE id = $1 AND status = 'active'", [schoolId]);
        if (!school.rows[0]) throw httpError(400, "Choose an active school.");
        const status = text(body.status) || "draft";
        if (!["draft", "published"].includes(status)) throw httpError(400, "Invalid subject note status.");
        const noteBody = text(body.body, "Body", false, 40_000);
        const attachmentIds = attachmentIdsFrom(body);
        if (!noteBody && !attachmentIds.length) throw httpError(400, "Add note content or at least one file.");
        const client = await pool.connect();
        let result;
        try {
            await client.query("BEGIN");
            result = await client.query(`INSERT INTO subject_notes (school_id, education_level_id, grade_id, program_id, subject_id, title, topic, body, status, created_by)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [
                schoolId, target.educationLevelId, target.gradeId, target.programId, target.subjectId,
                text(body.title, "Title", true, 240), text(body.topic, "Topic", false, 240),
                noteBody, status, req.auth.userId,
            ]);
            await saveSubjectNoteAttachments(client, result.rows[0].id, req.auth.userId, attachmentIds);
            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally { client.release(); }
        await audit(req, "subject_note.created", "subject_note", result.rows[0].id);
        return res.status(201).json({ data: result.rows[0] });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error("ADMIN SUBJECT NOTE CREATE ERROR:", error.message);
        return res.status(500).json({ message: "Subject note could not be created." });
    }
});

router.patch("/subject-notes/:id", async (req, res) => {
    const noteId = optionalInteger(req.params.id);
    if (!noteId) return res.status(400).json({ message: "Invalid subject note id." });
    const body = req.body || {};
    try {
        const target = await targetFrom(body, true);
        const schoolId = positiveInteger(body.schoolId, "School");
        const school = await pool.query("SELECT id FROM admin_schools WHERE id = $1 AND status = 'active'", [schoolId]);
        if (!school.rows[0]) throw httpError(400, "Choose an active school.");
        const noteBody = text(body.body, "Body", false, 40_000);
        const attachmentIds = attachmentIdsFrom(body);
        if (!noteBody && !attachmentIds.length) throw httpError(400, "Add note content or at least one file.");
        const client = await pool.connect();
        let result;
        try {
            await client.query("BEGIN");
            result = await client.query(`UPDATE subject_notes SET school_id = $1, education_level_id = $2, grade_id = $3, program_id = $4, subject_id = $5,
                title = $6, topic = $7, body = $8, updated_at = now() WHERE id = $9 RETURNING *`, [
                schoolId, target.educationLevelId, target.gradeId, target.programId, target.subjectId,
                text(body.title, "Title", true, 240), text(body.topic, "Topic", false, 240),
                noteBody, noteId,
            ]);
            if (!result.rows[0]) throw httpError(404, "Subject note not found.");
            await saveSubjectNoteAttachments(client, noteId, req.auth.userId, attachmentIds);
            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally { client.release(); }
        if (!result.rows[0]) throw httpError(404, "Subject note not found.");
        await audit(req, "subject_note.updated", "subject_note", noteId);
        return res.json({ data: result.rows[0] });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error("ADMIN SUBJECT NOTE UPDATE ERROR:", error.message);
        return res.status(500).json({ message: "Subject note could not be updated." });
    }
});

router.patch("/subject-notes/:id/status", async (req, res) => {
    const noteId = optionalInteger(req.params.id);
    const status = text(req.body && req.body.status);
    if (!noteId || !["draft", "published", "archived"].includes(status)) return res.status(400).json({ message: "Invalid subject note status." });
    try {
        if (status === "published") {
            const school = await pool.query("SELECT 1 FROM subject_notes n JOIN admin_schools s ON s.id = n.school_id WHERE n.id = $1 AND s.status = 'active'", [noteId]);
            if (!school.rows[0]) throw httpError(400, "Notes can only be published to an active school.");
        }
        const result = await pool.query("UPDATE subject_notes SET status = $1, updated_at = now() WHERE id = $2 RETURNING id, status, updated_at", [status, noteId]);
        if (!result.rows[0]) throw httpError(404, "Subject note not found.");
        await audit(req, `subject_note.${status}`, "subject_note", noteId);
        return res.json({ data: result.rows[0] });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error("ADMIN SUBJECT NOTE STATUS ERROR:", error.message);
        return res.status(500).json({ message: "Subject note status could not be changed." });
    }
});

router.delete("/subject-notes/:id", async (req, res) => {
    const noteId = optionalInteger(req.params.id);
    if (!noteId) return res.status(400).json({ message: "Invalid subject note id." });
    try {
        const result = await pool.query("DELETE FROM subject_notes WHERE id = $1 RETURNING id", [noteId]);
        if (!result.rows[0]) return res.status(404).json({ message: "Subject note not found." });
        await audit(req, "subject_note.deleted", "subject_note", noteId);
        return res.status(204).send();
    } catch (error) {
        console.error("ADMIN SUBJECT NOTE DELETE ERROR:", error.message);
        return res.status(500).json({ message: "Subject note could not be deleted." });
    }
});

router.delete("/subject-note-attachments/:id", async (req, res) => {
    const attachmentId = optionalInteger(req.params.id);
    if (!attachmentId) return res.status(400).json({ message: "Invalid attachment id." });
    try {
        const result = await pool.query("DELETE FROM subject_note_attachments WHERE id = $1 AND created_by = $2 AND note_id IS NULL RETURNING id", [attachmentId, req.auth.userId]);
        if (!result.rows[0]) return res.status(404).json({ message: "Unattached file not found." });
        return res.status(204).send();
    } catch (error) {
        console.error("ADMIN SUBJECT NOTE ATTACHMENT DELETE ERROR:", error.message);
        return res.status(500).json({ message: "The attachment could not be removed." });
    }
});

router.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    res.status(error.status || 500).json({ message: error.status ? error.message : "Admin request could not be completed." });
});

module.exports = router;