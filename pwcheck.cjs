const bcrypt = require('bcryptjs');
const hash = '$2b$12$dYs68.CkOUdWhr/G3/87WerFrMFA50YlDAxkQtNZshfB1VpYFFSBy';
const words = [
    'Kevin', 'Kevin123', 'Kevin123!', 'kevin', 'kevin123', 'kevin123!', 'Admin', 'Admin123', 'Admin123!', 'admin', 'admin123', 'admin123!', 'Edusphere', 'EduSphere', 'EduSphere123', 'EduSphere123!', 'Edusphere123', 'Edusphere123!', 'EduSphere2026', 'EduSphere2026!', 'Password', 'Password123', 'Password123!', 'Welcome', 'Welcome123', 'Welcome123!', 'School', 'School123', 'School123!', 'Qwerty', 'Qwerty123', 'Qwerty123!', 'Test', 'Test123', 'Test123!', '123456', '12345678', '123456789', '1234567890', 'Kevin@123', 'Kevin!123', 'Kevin@2026', 'Edu@2026', 'Admin@2026', 'Admin!2026', 'Education123!', 'Sphere123!'
];
(async () => {
    const matches = [];
    for (const word of words) {
        const ok = await bcrypt.compare(word, hash);
        if (ok) matches.push(word);
    }
    console.log(matches.length ? matches.join(', ') : 'NO_MATCH');
})();
