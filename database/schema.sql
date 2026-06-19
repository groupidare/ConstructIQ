-- ConstructIQ Database Schema
-- MySQL 8.0+

CREATE DATABASE IF NOT EXISTS constructiq CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE constructiq;

-- Users
CREATE TABLE users (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL UNIQUE,
    email         VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name    VARCHAR(80)  NOT NULL,
    last_name     VARCHAR(80)  NOT NULL,
    role          ENUM('Admin','ProjectManager','SiteEngineer','WarehousePersonnel','ProcurementOfficer') NOT NULL DEFAULT 'SiteEngineer',
    is_active     TINYINT(1)   NOT NULL DEFAULT 1,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Projects
CREATE TABLE projects (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name                VARCHAR(200) NOT NULL,
    type                ENUM('Residential','Commercial','Industrial','Infrastructure','Mixed') NOT NULL,
    location            VARCHAR(300) NOT NULL,
    description         TEXT,
    budget              DECIMAL(18,2),
    start_date          DATE         NOT NULL,
    target_end_date     DATE         NOT NULL,
    actual_end_date     DATE,
    status              ENUM('Planning','Active','OnHold','Completed','Cancelled') NOT NULL DEFAULT 'Planning',
    assigned_contractor VARCHAR(200),
    project_manager_id  INT UNSIGNED,
    site_engineer_id    INT UNSIGNED,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (project_manager_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (site_engineer_id)   REFERENCES users(id) ON DELETE SET NULL
);

-- Phases
CREATE TABLE phases (
    id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    project_id       INT UNSIGNED NOT NULL,
    name             VARCHAR(100) NOT NULL,
    `order`          INT          NOT NULL DEFAULT 1,
    start_date       DATE         NOT NULL,
    end_date         DATE         NOT NULL,
    status           ENUM('Pending','Active','Completed','Delayed') NOT NULL DEFAULT 'Pending',
    progress_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Material Categories
CREATE TABLE material_categories (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Materials
CREATE TABLE materials (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_id   INT UNSIGNED NOT NULL,
    name          VARCHAR(200) NOT NULL,
    specification VARCHAR(500),
    unit          VARCHAR(30)  NOT NULL,
    unit_cost     DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    is_active     TINYINT(1)   NOT NULL DEFAULT 1,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES material_categories(id) ON DELETE RESTRICT
);

-- Bill of Quantities
CREATE TABLE boq_items (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    project_id          INT UNSIGNED NOT NULL,
    phase_id            INT UNSIGNED,
    material_id         INT UNSIGNED NOT NULL,
    estimated_quantity  DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    actual_quantity     DECIMAL(18,4),
    estimated_unit_cost DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id)  REFERENCES projects(id)  ON DELETE CASCADE,
    FOREIGN KEY (phase_id)    REFERENCES phases(id)    ON DELETE SET NULL,
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT
);

-- Inventory Records
CREATE TABLE inventory_records (
    id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    project_id         INT UNSIGNED NOT NULL,
    material_id        INT UNSIGNED NOT NULL,
    available_quantity DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    used_quantity      DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    wasted_quantity    DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    excess_quantity    DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    reorder_point      DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    target_stock_level DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    stock_status       ENUM('Normal','LowStock','OutOfStock','Overstock') NOT NULL DEFAULT 'Normal',
    last_updated       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_inv_project_material (project_id, material_id),
    FOREIGN KEY (project_id)  REFERENCES projects(id)  ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT
);

-- Material Movements
CREATE TABLE material_movements (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    inventory_record_id INT UNSIGNED NOT NULL,
    project_id          INT UNSIGNED NOT NULL,
    material_id         INT UNSIGNED NOT NULL,
    movement_type       ENUM('Received','Released','Returned','Wasted','Transferred') NOT NULL,
    quantity            DECIMAL(18,4) NOT NULL,
    phase_id            INT UNSIGNED,
    notes               TEXT,
    recorded_by_user_id INT UNSIGNED,
    recorded_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (inventory_record_id) REFERENCES inventory_records(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id)          REFERENCES projects(id)           ON DELETE CASCADE,
    FOREIGN KEY (material_id)         REFERENCES materials(id)          ON DELETE RESTRICT,
    FOREIGN KEY (phase_id)            REFERENCES phases(id)             ON DELETE SET NULL,
    FOREIGN KEY (recorded_by_user_id) REFERENCES users(id)             ON DELETE SET NULL
);

-- Excess / Waste Records
CREATE TABLE excess_waste_records (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    project_id          INT UNSIGNED NOT NULL,
    phase_id            INT UNSIGNED,
    material_id         INT UNSIGNED NOT NULL,
    excess_type         ENUM('Unused','Damaged','Expired','Overordered') NOT NULL,
    quantity            DECIMAL(18,4) NOT NULL,
    unit_cost           DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    total_cost          DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    excess_percent      DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
    is_reusable         TINYINT(1)    NOT NULL DEFAULT 0,
    notes               TEXT,
    recorded_by_user_id INT UNSIGNED,
    recorded_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id)          REFERENCES projects(id)  ON DELETE CASCADE,
    FOREIGN KEY (phase_id)            REFERENCES phases(id)    ON DELETE SET NULL,
    FOREIGN KEY (material_id)         REFERENCES materials(id) ON DELETE RESTRICT,
    FOREIGN KEY (recorded_by_user_id) REFERENCES users(id)     ON DELETE SET NULL
);

-- Forecast Results
CREATE TABLE forecast_results (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    project_id     INT UNSIGNED NOT NULL,
    phase_id       INT UNSIGNED,
    period         ENUM('Weekly','Monthly','PhaseEnd') NOT NULL DEFAULT 'Monthly',
    model_accuracy DECIMAL(5,2),
    generated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    generated_by   INT UNSIGNED,
    FOREIGN KEY (project_id)  REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (phase_id)    REFERENCES phases(id)   ON DELETE SET NULL,
    FOREIGN KEY (generated_by)REFERENCES users(id)    ON DELETE SET NULL
);

-- Forecasted Materials (children of forecast_results)
CREATE TABLE forecasted_materials (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    forecast_result_id  INT UNSIGNED NOT NULL,
    material_id         INT UNSIGNED NOT NULL,
    forecasted_quantity DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    current_stock       DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    shortage            DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    reorder_suggestion  DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    risk_level          ENUM('Low','Medium','High','Critical') NOT NULL DEFAULT 'Low',
    FOREIGN KEY (forecast_result_id) REFERENCES forecast_results(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id)        REFERENCES materials(id)         ON DELETE RESTRICT
);

-- Procurement Recommendations
CREATE TABLE procurement_recommendations (
    id                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    project_id              INT UNSIGNED NOT NULL,
    material_id             INT UNSIGNED NOT NULL,
    current_stock           DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    reorder_point           DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    target_stock_level      DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    forecasted_demand       DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    recommended_quantity    DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    estimated_cost          DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    suggested_reorder_date  DATE,
    estimated_lead_time_days INT          NOT NULL DEFAULT 7,
    urgency_level           ENUM('Low','Medium','High','Critical') NOT NULL DEFAULT 'Medium',
    notes                   TEXT,
    generated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id)  REFERENCES projects(id)  ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT
);

-- Purchase Requests
CREATE TABLE purchase_requests (
    id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    project_id           INT UNSIGNED NOT NULL,
    recommendation_id    INT UNSIGNED,
    material_id          INT UNSIGNED NOT NULL,
    requested_quantity   DECIMAL(18,4) NOT NULL,
    estimated_unit_cost  DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    total_estimated_cost DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
    status               ENUM('Pending','Approved','Rejected','Ordered','Received') NOT NULL DEFAULT 'Pending',
    notes                TEXT,
    requested_by_user_id INT UNSIGNED,
    requested_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_by_user_id  INT UNSIGNED,
    approved_at          DATETIME,
    FOREIGN KEY (project_id)           REFERENCES projects(id)                   ON DELETE CASCADE,
    FOREIGN KEY (recommendation_id)    REFERENCES procurement_recommendations(id) ON DELETE SET NULL,
    FOREIGN KEY (material_id)          REFERENCES materials(id)                  ON DELETE RESTRICT,
    FOREIGN KEY (requested_by_user_id) REFERENCES users(id)                      ON DELETE SET NULL,
    FOREIGN KEY (approved_by_user_id)  REFERENCES users(id)                      ON DELETE SET NULL
);

-- Activity Logs
CREATE TABLE activity_logs (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED,
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id   INT UNSIGNED,
    ip_address  VARCHAR(45),
    details     TEXT,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
