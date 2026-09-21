-- Additive TVET catalog. Programs remain data rows, so new offerings need no UI change.
CREATE TABLE IF NOT EXISTS tvet_program_levels (
    program_id BIGINT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    grade_id BIGINT NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
    PRIMARY KEY (program_id, grade_id)
);

CREATE INDEX IF NOT EXISTS tvet_program_levels_grade_idx
    ON tvet_program_levels(grade_id, program_id);

DO $$
DECLARE
    program_record RECORD;
    program_id_value BIGINT;
    grade_record RECORD;
BEGIN
    FOR program_record IN
        SELECT * FROM (VALUES
            ('Software Development (SOD)', 'Software development, programming, databases, and application delivery.'),
            ('Computer Systems and Architecture (CSA)', 'Computer hardware, operating systems, systems architecture, and support.'),
            ('Networking', 'Network infrastructure, connectivity, administration, and security foundations.'),
            ('Multimedia Production', 'Audio, video, animation, digital media, and production workflows.'),
            ('Information Technology', 'IT support, systems administration, productivity platforms, and digital services.'),
            ('Electronics Technology', 'Electronic circuits, devices, instrumentation, and repair.'),
            ('Electrical Installation', 'Electrical wiring, installation, maintenance, and safety.'),
            ('Renewable Energy', 'Solar, wind, renewable power systems, installation, and maintenance.'),
            ('Construction Technology', 'Construction methods, materials, surveying, and site practice.'),
            ('Plumbing', 'Plumbing installation, water systems, maintenance, and safety.'),
            ('Plumbing and Sanitation', 'Water supply, sanitation systems, plumbing installation, and maintenance.'),
            ('Masonry', 'Brickwork, blockwork, concrete, finishes, and site practice.'),
            ('Carpentry and Joinery', 'Woodworking, joinery, furniture, and construction practice.'),
            ('Tiling', 'Floor and wall tiling, surface preparation, finishes, and safety.'),
            ('Painting and Decoration', 'Surface preparation, paint application, decoration, and finishes.'),
            ('Welding and Fabrication', 'Welding processes, fabrication, workshop practice, and safety.'),
            ('Automobile Technology', 'Vehicle systems, diagnostics, maintenance, and repair.'),
            ('Automotive Electricity', 'Vehicle electrical systems, diagnostics, wiring, and repair.'),
            ('Wood Technology', 'Wood processing, products, machinery, and workshop practice.'),
            ('Manufacturing Technology', 'Manufacturing processes, production systems, quality, and safety.'),
            ('Mechanical Technology', 'Mechanical systems, machining, maintenance, and workshop practice.'),
            ('Refrigeration and Air Conditioning', 'Cooling systems, refrigeration, air conditioning, installation, and repair.'),
            ('Agriculture and Agribusiness', 'Crop production, animal care, farm operations, and agribusiness.'),
            ('Animal Health', 'Animal care, livestock health, disease prevention, and farm practice.'),
            ('Food Processing', 'Food preservation, processing, packaging, quality, and safety.'),
            ('Hospitality Management', 'Hospitality operations, service, accommodation, and guest care.'),
            ('Culinary Arts', 'Food preparation, kitchen operations, nutrition, and service.'),
            ('Fashion and Design', 'Garment construction, textiles, design, and production.'),
            ('Tailoring', 'Pattern making, garment construction, alterations, and textile practice.'),
            ('Beauty and Hairdressing', 'Hair, beauty services, client care, and salon operations.'),
            ('Tourism Operations', 'Tour guiding, travel services, tourism products, and guest care.'),
            ('Graphic Design', 'Visual communication, digital design, branding, and production.'),
            ('Printing Technology', 'Print production, prepress, finishing, and publication workflows.'),
            ('Water Technology', 'Water systems, treatment, distribution, conservation, and maintenance.'),
            ('Mining Technology', 'Mining operations, equipment, safety, geology, and environmental practice.'),
            ('Transport and Logistics', 'Transport operations, warehousing, supply chains, and logistics.'),
            ('TVET Accounting and Business', 'Bookkeeping, business operations, entrepreneurship, and finance basics.')
        ) AS catalog(name, description)
    LOOP
        SELECT id INTO program_id_value FROM programs WHERE name = program_record.name ORDER BY id LIMIT 1;
        IF program_id_value IS NULL THEN
            INSERT INTO programs (name, description)
            VALUES (program_record.name, program_record.description)
            RETURNING id INTO program_id_value;
        END IF;

        FOR grade_record IN
            SELECT id FROM grades WHERE code IN ('L3', 'L4', 'L5')
        LOOP
            INSERT INTO tvet_program_levels (program_id, grade_id)
            VALUES (program_id_value, grade_record.id)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;