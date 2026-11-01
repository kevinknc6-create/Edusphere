# Rwanda curriculum research and implementation notes

Research checked on 2026-10-31. This note distinguishes official statements that were verifiable from subject-level content that could not be confirmed from the accessible official sources. The database is intentionally not seeded with unverified subjects, subject combinations, learning outcomes, or TVET programme-to-level mappings.

## Verified from official sources

| Authority / source | Verified information | Link |
|---|---|---|
| Rwanda Education Board (REB), Curriculum, Teaching & Learning Resources Department | REB's mandate includes developing the national curriculum and textbooks for pre-primary, primary, secondary and special schools, STEM curriculum, accessible multimedia textbooks, and adapting materials for learner needs. The page does not itself enumerate current subjects by class. | [REB department](https://www.reb.gov.rw/curriculum-teaching-learning-resources-department) |
| Ministry of Education (MINEDUC), Basic Education | The Ministry describes basic education as pre-primary, primary and secondary, and notes TVET at secondary and higher levels. It describes Rwanda's 2015-approved play-based competency-based pre-primary curriculum and refers to the Education Sector Strategic Plan 2018/19–2023/24. This is historical policy context, not a current subject catalogue. | [MINEDUC Basic Education](https://www.mineduc.gov.rw/basic-education) |
| Rwanda TVET Board (RTB), Curriculum & Instructional Materials Development | RTB's department is tasked with developing, regularly updating and monitoring TVET curricula; it engages Technical Expertise Groups and occupational-standard stakeholders and develops trainers' and trainees' manuals. | [RTB curriculum department](https://www.rtb.gov.rw/curriculum-instructional-materials-development-department) |
| RTB e-learning course catalogue | The public catalogue lists sector categories including Agriculture & Food Processing, Construction & Building Services, Crafts & Arts, Energy, Hospitality & Tourism, ICT & Multimedia, Manufacturing and Mining Sector, Technical Services, and Transport & Logistics. These are catalogue categories, not proof of specific qualifications, programme titles, levels, modules or units. | [RTB e-learning catalogue](https://www.elearning.rtb.gov.rw/course/) |
| National Examination and School Inspection Authority (NESA), Basic Education and TVET Examination Department | NESA's stated responsibilities include examinations, selection, assessment, certification, policies and examination item development. This is useful for assessment alignment but is not evidence for a subject combination or curriculum sequence. | [NESA department](https://www.nesa.gov.rw/1/basic-education-and-tvet-examination-department) |

## Class progression and evidence limits

The requested platform structure covers P1–P6, S1–S3, S4–S6 and TVET L3–L5. The current REB, MINEDUC, NESA and RTB pages reviewed above do not provide a current, authoritative, downloadable subject-by-class matrix, an S4–S6 combination list with its subject membership, or the official Software Development qualification specification and its level-by-level modules, units and outcomes. REB's e-learning host could not be retrieved during this research pass. The RTB catalogue's category labels cannot be promoted to programme names.

Therefore:

- No primary or secondary subject names, learning-area lists, subject combinations, progression claims or learning outcomes are added as verified curriculum records.
- No TVET programme list or Software Development L3/L4/L5 module sequence is marked official based only on sector names or existing application records.
- Existing records in the legacy TVET catalogue migration are application data, not verified evidence of current RTB approval. The new schema marks programmes unverified unless an administrator records a source and completes verification.
- Existing course-library records remain publishable learning content, but they are not represented as national curriculum mappings unless linked to an active, reviewed curriculum version.
- The subject-combination field is optional until the school/admin supplies the student's correct combination. Students are not asked to guess their curriculum level when an account profile already supplies it.

## Data model

The legacy PostgreSQL schema already has education levels/classes, programs, curriculum sources and versions, curriculum combinations, curriculum subjects, and TVET subjects/competences/modules/units. Migration `backend/migrations/019_curriculum_enrollment_and_outcomes.sql` adds school and combination links to the existing user profile; explicit student-to-curriculum-subject enrollments; structured units and outcomes; source verification dates/status; and curriculum materials with school textbook assignments. The migration adds no student, school or curriculum catalogue records.

The dashboard only renders active curriculum versions, published course content and explicitly enrolled curriculum subjects. Empty states are intentional until administrators verify sources, configure mappings, and enroll learners.
