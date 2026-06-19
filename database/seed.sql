USE constructiq;

-- Admin user (password: Admin@123)
INSERT INTO users (username, email, password_hash, first_name, last_name, role)
VALUES (
    'admin',
    'admin@constructiq.com',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewT5l6JVtLzFwn2O',  -- bcrypt of Admin@123
    'System',
    'Administrator',
    'Admin'
);

-- Sample project manager
INSERT INTO users (username, email, password_hash, first_name, last_name, role)
VALUES (
    'jdelacruz',
    'jdelacruz@constructiq.com',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewT5l6JVtLzFwn2O',
    'Jose',
    'Dela Cruz',
    'ProjectManager'
);

-- Sample site engineer
INSERT INTO users (username, email, password_hash, first_name, last_name, role)
VALUES (
    'mreyes',
    'mreyes@constructiq.com',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewT5l6JVtLzFwn2O',
    'Maria',
    'Reyes',
    'SiteEngineer'
);

-- Sample warehouse personnel
INSERT INTO users (username, email, password_hash, first_name, last_name, role)
VALUES (
    'psantos',
    'psantos@constructiq.com',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewT5l6JVtLzFwn2O',
    'Pedro',
    'Santos',
    'WarehousePersonnel'
);

-- Sample procurement officer
INSERT INTO users (username, email, password_hash, first_name, last_name, role)
VALUES (
    'agarcía',
    'agarcia@constructiq.com',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewT5l6JVtLzFwn2O',
    'Ana',
    'Garcia',
    'ProcurementOfficer'
);

-- Material Categories
INSERT INTO material_categories (name, description) VALUES
('Concrete & Masonry',    'Cement, sand, gravel, hollow blocks, CHB'),
('Steel & Metals',        'Rebar, steel bars, GI pipes, angle bars, purlins'),
('Wood & Lumber',         'Coco lumber, plywood, form lumber'),
('Roofing Materials',     'GI sheets, roofing screws, ridge rolls, gutter'),
('Electrical Materials',  'Wires, conduits, outlets, breakers, panels'),
('Plumbing Materials',    'PVC pipes, fittings, valves, water heaters'),
('Finishing Materials',   'Tiles, paint, putty, sealant, grout'),
('Doors & Windows',       'Steel doors, aluminum windows, jalousie'),
('Hardware & Fasteners',  'Nails, bolts, screws, wire, anchors'),
('Waterproofing',         'Waterproofing compound, membrane, sealant');

-- Concrete & Masonry
INSERT INTO materials (category_id, name, specification, unit, unit_cost) VALUES
(1, 'Portland Cement',          'Type I, 40kg bag',                              'bag',  310.00),
(1, 'Washed Sand',              'Fine aggregate, river sand',                    'm3',   800.00),
(1, 'Crushed Gravel',           '3/4" crushed gravel',                           'm3',  1200.00),
(1, 'Hollow Blocks',            '6" x 8" x 16" CHB, 3.5 MPa',                   'pcs',   15.00),
(1, 'Hollow Blocks 4"',         '4" x 8" x 16" CHB',                            'pcs',   12.00);

-- Steel
INSERT INTO materials (category_id, name, specification, unit, unit_cost) VALUES
(2, 'Deformed Bar 10mm',        '10mm ø x 6m, Grade 60',                         'pcs',  215.00),
(2, 'Deformed Bar 12mm',        '12mm ø x 6m, Grade 60',                         'pcs',  310.00),
(2, 'Deformed Bar 16mm',        '16mm ø x 6m, Grade 60',                         'pcs',  545.00),
(2, 'GI Wire #16',              'Galvanized iron tie wire, 45kg roll',            'roll', 1800.00),
(2, 'Angle Bar 2" x 2" x 3mm', '6m length',                                     'pcs',  450.00);

-- Wood
INSERT INTO materials (category_id, name, specification, unit, unit_cost) VALUES
(3, 'Coco Lumber 2x3',          '2" x 3" x 10ft, kiln dried',                   'pcs',   85.00),
(3, 'Coco Lumber 2x4',          '2" x 4" x 10ft, kiln dried',                   'pcs',  110.00),
(3, 'Marine Plywood 1/2"',      '4\' x 8\' x 12mm, marine grade',               'sht',  820.00),
(3, 'Marine Plywood 3/4"',      '4\' x 8\' x 18mm, marine grade',               'sht', 1150.00);

-- Roofing
INSERT INTO materials (category_id, name, specification, unit, unit_cost) VALUES
(4, 'Pre-painted Corrugated GI Sheet', 'GA 26, pre-painted long span',           'm',    180.00),
(4, 'Ridge Roll',               'Pre-painted, 0.5m x 6m',                        'pcs',  350.00),
(4, 'Roofing Screw',            'Hex head with rubber washer, 75mm',              'pcs',    4.50),
(4, 'Gutter Pre-formed',        'GA 26, 3m length',                              'pcs',  380.00);

-- Electrical
INSERT INTO materials (category_id, name, specification, unit, unit_cost) VALUES
(5, 'THHN Wire #12',            '3.5mm², stranded, 150m roll',                   'roll', 2800.00),
(5, 'THHN Wire #10',            '5.5mm², stranded, 150m roll',                   'roll', 4200.00),
(5, 'PVC Conduit 20mm',         '20mm ø x 3m, Schedule 40',                      'pcs',   85.00),
(5, 'Circuit Breaker 20A',      '1-pole, 20A, 240V',                             'pcs',  380.00);

-- Finishing
INSERT INTO materials (category_id, name, specification, unit, unit_cost) VALUES
(7, 'Ceramic Floor Tile 60x60', '60x60cm, matte finish, Grade A',                'sqm',  420.00),
(7, 'Ceramic Wall Tile 30x60',  '30x60cm, glossy, Grade A',                      'sqm',  380.00),
(7, 'Paint - Flatwall Latex',   '4L can, white/off-white',                       'can',  420.00),
(7, 'Tile Adhesive',            '25kg bag, polymer-modified',                    'bag',  320.00),
(7, 'Tile Grout',               '2kg bag, sanded, multiple colors',              'bag',   85.00);

-- Sample Project
INSERT INTO projects (name, type, location, description, budget, start_date, target_end_date, status, project_manager_id, site_engineer_id)
VALUES (
    'Dela Cruz Residential House',
    'Residential',
    'Quezon City, Metro Manila',
    '2-storey residential house, 120sqm floor area',
    3500000.00,
    '2026-07-01',
    '2026-12-31',
    'Planning',
    2,  -- jdelacruz
    3   -- mreyes
);

-- Phases for sample project
INSERT INTO phases (project_id, name, `order`, start_date, end_date, status) VALUES
(1, 'Foundation',  1, '2026-07-01', '2026-07-31', 'Pending'),
(1, 'Structural',  2, '2026-08-01', '2026-09-15', 'Pending'),
(1, 'Roofing',     3, '2026-09-16', '2026-10-15', 'Pending'),
(1, 'Walling',     4, '2026-10-01', '2026-11-15', 'Pending'),
(1, 'Finishing',   5, '2026-11-01', '2026-12-31', 'Pending');
