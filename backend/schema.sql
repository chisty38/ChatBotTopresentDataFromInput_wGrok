-- Paste the following schema into your SQL Server (this is the schema you provided)
DROP TABLE IF EXISTS SalesApp_LogInActivity;
CREATE TABLE SalesApp_LogInActivity (
    LogInActivityID INT IDENTITY(1,1) PRIMARY KEY,
    UserID INT NOT NULL,
    Token VARCHAR(max) NOT NULL,
    LogedIn datetime default CONVERT(DATETIME,GETDATE() AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time'),
    LogOut DATETIME NULL,
    IpLog VARCHAR(20),
    Activity varchar(max) NULL,
    CONSTRAINT FK_User FOREIGN KEY (UserID) REFERENCES FormCheckList_Users(userID)
);

ALTER TABLE SalesApp_LogInActivity
ADD Device varchar(25);

ALTER TABLE SalesApp_LogInActivity
ADD IpLocation varchar(55);
DROP TABLE IF EXISTS SalesReport_Form_Input;
CREATE TABLE SalesReport_Form_Input (
    ID int IDENTITY(1,1) NOT NULL,
    LEAD_ID varchar(55),
    LAST_NAME varchar(255),
    FIRST_NAME varchar(255),
    STOCK varchar(255),
    CAR_STATUS varchar(55),
    MAKE_YEAR varchar(10),
    MAKE varchar(255),
    MODEL varchar(255),
    FRONT_COST varchar(55),
    FI_COST varchar(255),
    ADMIN_COST varchar(10),
    TOTAL_COST varchar(255),
    LEAD_SOURCE varchar(55),
    LEAD_OWNER varchar(55),
    CLOSER varchar(255),
    LENDER varchar(55),
    SENT_TO_HQ varchar(255),
    DEALER_LOCATION varchar(55),
    MONTH_REPORTED varchar(25),
    DIVISION varchar(255),
    VEHICLE_TYPE varchar(255),
    DATE_REPORTED datetime default getdate(),
    DATE_CREATED datetime default getdate(),
    LastUpdated datetime,
    EditedBy varchar(255)
    CONSTRAINT PK_SalesReport_Form_Input PRIMARY KEY (ID)
);

CREATE INDEX IX_SalesReport_Form_Input_STOCK ON SalesReport_Form_Input (STOCK);
CREATE INDEX IX_SalesReport_Form_Input_ID ON SalesReport_Form_Input (ID);

ALTER TABLE SalesReport_Form_Input
ADD USERNAME varchar(100);

ALTER TABLE SalesReport_Form_Input
ADD USER_IP varchar(55);

ALTER TABLE SalesReport_Form_Input
ADD YEAR_REPORTED varchar(25);

ALTER TABLE SalesReport_Form_Input
ADD SOLD_FROM varchar(25);

ALTER TABLE SalesReport_Form_Input
ALTER COLUMN SOLD_FROM varchar(55);

ALTER TABLE SalesReport_Form_Input
ADD WEEK_REPORTED varchar(25);

ALTER TABLE SalesReport_Form_Input
ADD DATE_RECEIVED varchar(25);

ALTER TABLE SalesReport_Form_Input
ADD DATE_FUNDED varchar(25);

ALTER TABLE SalesReport_Form_Input
ADD DATE_POSTED varchar(25);

ALTER TABLE SalesReport_Form_Input
ADD TOTAL_COST_OLD varchar(55) NOT NULL DEFAULT '0'

ALTER TABLE SalesReport_Form_Input
ADD BDC_Rep varchar(255);

ALTER TABLE SalesReport_Form_Input
ADD BDC_APPType varchar(55);

ALTER TABLE SalesReport_Form_Input
ADD COST_LastUpdated datetime

ALTER TABLE SalesReport_Form_Input
ADD RDR varchar(100);


ALTER TABLE SalesReport_Form_Input
ADD DEALID varchar(100);

ALTER TABLE SalesReport_Form_Input
ADD DEALKEY varchar(100);

ALTER TABLE SalesReport_Form_Input
ADD NOTE varchar(max);

ALTER TABLE SalesReport_Form_Input
ADD PBS_DATA varchar(max);

ALTER TABLE SalesReport_Form_Input
ADD isAudited bit NOT NULL DEFAULT 0

ALTER TABLE SalesReport_Form_Input
ADD AuditedBy varchar(100);

ALTER TABLE SalesReport_Form_Input
ADD LastAudited varchar(25);

ALTER TABLE SalesReport_Form_Input
ADD isCarryOver bit NOT NULL DEFAULT 0

ALTER TABLE SalesReport_Form_Input
ADD isDeleted bit NOT NULL DEFAULT 0

ALTER TABLE SalesReport_Form_Input
ADD isPending bit NOT NULL DEFAULT 0

ALTER TABLE SalesReport_Form_Input
ADD isCounted bit NOT NULL DEFAULT 1 -- 1 = true, 0=false

ALTER TABLE SalesReport_Form_Input
ADD isPBS_Match bit NOT NULL DEFAULT 1 

ALTER TABLE SalesReport_Form_Input
ADD Dab_DATA varchar(max) NOT NULL DEFAULT '';

ALTER TABLE SalesReport_Form_Input
ADD TeamID int;

ALTER TABLE SalesReport_Form_Input
ADD TeamName varchar(255);

ALTER TABLE SalesReport_Form_Input
ADD HasLien bit NOT NULL DEFAULT 0  --true = 1, false = 0

ALTER TABLE SalesReport_Form_Input
ADD isDeliverd bit NOT NULL DEFAULT 0  --true = 1, false = 0

ALTER TABLE SalesReport_Form_Input
ADD DATE_DELIVERD varchar(25);

ALTER TABLE SalesReport_Form_Input
ADD HEAR_ABOUTUS varchar(255) 

ALTER TABLE SalesReport_Form_Input
ADD MODELWANTED varchar(55)

ALTER TABLE SalesReport_Form_Input
ADD GET_INFO varchar(255)

ALTER TABLE SalesReport_Form_Input
ADD SETAPPOINTMENT varchar(55)


ALTER TABLE SalesReport_Form_Input
ADD Scorboard_Data varchar(max);


ALTER TABLE SalesReport_Form_Input
ADD Inv_Data varchar(max);

ALTER TABLE SalesReport_Form_Input
ADD DealReportedJson varchar(max);

ALTER TABLE SalesReport_Form_Input
ADD isUnpostable bit NOT NULL DEFAULT 0

ALTER TABLE SalesReport_Form_Input
ADD isCompleted bit NOT NULL DEFAULT 0  --true = 1, false = 0
DROP TABLE IF EXISTS Common_Group_401_Vehicle_Inventory;
CREATE TABLE Common_Group_401_Vehicle_Inventory (
    ID int IDENTITY(1,1) NOT NULL,
    vId varchar(50),
    VehicleId varchar(100),
    StockNumber varchar(100),
    VIN varchar(100),
    VehicleStatus varchar(100),
    SerialNumber varchar(100),
    ModelNumber varchar(100),
    VehicleMake varchar(50),
    VehicleModel varchar(50),
    VehicleTrim varchar(100),
    VehicleType varchar(50),
    VehicleYear varchar(50),
    Odometer varchar(100),
    Engine varchar(50),
    Cylinders varchar(50),
    Transmission varchar(50),
    DriveWheel varchar(50),
    Body varchar(50),
    SeatingCapacity varchar(50),
    Lot varchar(100),
    LotDescription varchar(50),
    DateReceived varchar(100),
    IsCertified bit NOT NULL DEFAULT 0,
    LastUpdate varchar(50),
    Inventory varchar(50),
    ShortVIN varchar(50),
    TotalCost varchar(50),
    Retail varchar(50),
    Hold_HoldFrom varchar(50),
    Hold_HoldUntil varchar(50),
    Hold_Comments varchar(max),
    Order_Description varchar(max),
    ExteriorColor_Code varchar(50),
    ExteriorColor_Description varchar(50),
    InteriorColor_Code varchar(50),
    InteriorColor_Description varchar(50),
    Warranties_Type varchar(100),
    Warranties_CoveragePlan varchar(100),
    Warranties_ExpirationMileage varchar(50),
    isHold bit NOT NULL DEFAULT 0, --0=false, 1=true
    isSold bit NOT NULL DEFAULT 0, -- 0=false, 1=true
    isDeleted bit NOT NULL DEFAULT 0, -- 0=false, 1=true
    EditedBy varchar(255),
    DATE_Updated datetime,
    DATE_CREATED datetime default getdate(),
    CONSTRAINT PK_Common_Group_401_Vehicle_Inventory PRIMARY KEY (ID)
);

ALTER TABLE Common_Group_401_Vehicle_Inventory
ADD isAvailable bit NOT NULL DEFAULT 1 -- default true

ALTER TABLE Common_Group_401_Vehicle_Inventory
ADD MSR varchar(50) 

ALTER TABLE Common_Group_401_Vehicle_Inventory
ADD BaseMSR varchar(50) 

ALTER TABLE Common_Group_401_Vehicle_Inventory
ADD InternetPrice varchar(50) 

ALTER TABLE Common_Group_401_Vehicle_Inventory
ADD InServiceDate varchar(50) 

ALTER TABLE Common_Group_401_Vehicle_Inventory
ADD FloorPlanCode varchar(50) 

ALTER TABLE Common_Group_401_Vehicle_Inventory
ADD FloorPlanAmount varchar(50) 

ALTER TABLE Common_Group_401_Vehicle_Inventory
ADD Order_Price varchar(50) 

ALTER TABLE Common_Group_401_Vehicle_Inventory
ADD Category varchar(255) 

ALTER TABLE Common_Group_401_Vehicle_Inventory
ADD AppraisedValue varchar(255) 

ALTER TABLE Common_Group_401_Vehicle_Inventory
ADD CriticalMemo varchar(255) 

ALTER TABLE Common_Group_401_Vehicle_Inventory
ADD Warranties varchar(max) 

ALTER TABLE Common_Group_401_Vehicle_Inventory
ALTER COLUMN CriticalMemo nvarchar(max)

CREATE INDEX IX_Common_Group_401_Vehicle_Inventory_StockNumber ON Common_Group_401_Vehicle_Inventory (StockNumber);
