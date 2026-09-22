import { createArcGisAdapter, type ArcGisConfig } from "./arcgis";
import { createShovelsAdapter } from "./shovels";
import { createSocrataAdapter, type SocrataConfig } from "./socrata";
import type { SourceAdapter, SourceCapabilities } from "./types";

/**
 * The source registry.
 *
 * Ordering principle: freshness first. A contractor bidding work needs permits
 * that surfaced days ago, so direct jurisdiction endpoints outrank aggregated
 * national feeds even when the aggregator carries more fields.
 *
 * Every endpoint below was probed with a live request on 2026-09-21. Sources
 * that have gone stale are kept but flagged archival, because a frozen portal
 * still answers HTTP 200 and would otherwise serve years-old rows as leads.
 *
 * Coverage gaps worth knowing: Broward, Palm Beach, Jacksonville/Duval, Orange
 * County FL and Pinellas/Tampa proper publish no usable API. They run Accela or
 * Tyler EnerGov citizen portals and need scraping or a commercial feed.
 */

/** Most jurisdiction feeds share this capability shape; override per source. */
function caps(overrides: Partial<SourceCapabilities> = {}): SourceCapabilities {
  return {
    dateRange: true, textSearch: true, exactCount: true, pagination: true,
    contractor: false, owner: false, jobValue: false, latLng: false,
    ...overrides,
  };
}

const arcgis = (config: ArcGisConfig) => createArcGisAdapter(config);
const socrata = (config: SocrataConfig) => createSocrataAdapter(config);

/* ═══════════════════════════════════════════════════════════════════════════
   FLORIDA - statewide
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Florida DEP Environmental Resource Permits (layer 3, "ERP from PA").
 *
 * The earliest signal in the stack and the only statewide Florida feed that
 * exists. An ERP covers stormwater systems, dredge and fill, and land clearing,
 * so it is filed *before* the local building permit - which is exactly when a
 * site-work contractor wants the call. Covers all 67 counties, names the
 * applicant company, ~260 new filings a week, roughly a one-day lag.
 */
const fdepErp = arcgis({
  descriptor: {
    id: "fl-fdep-erp",
    label: "FL DEP Environmental Resource Permits",
    state: "FL",
    jurisdiction: "Florida DEP",
    cadence: "daily",
    capabilities: caps({ owner: true, latLng: true }),
    notes: "Statewide pre-construction signal, filed before the local building permit. No job value reported.",
  },
  layerUrl: "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/ERP/MapServer/3",
  fields: {
    permit_number: "APP_NO",
    address: "ADDRESS",
    city: "CITY",
    zipcode: "ZIP5",
    description: "PROJ_DESC",
    permit_type: "PER_DESC",
    status: "AGENCY_ACT",
    file_date: "RCVD_DATE",
    issue_date: "ACT_DATE",
    owner_company: "COMPANY",
    owner_name: "APP_NAME",
  },
  maxRecordCount: 1000,
});

/* ═══════════════════════════════════════════════════════════════════════════
   FLORIDA - counties and cities
   ═══════════════════════════════════════════════════════════════════════════ */

/** The only Florida feed carrying owner, contractor, contractor phone AND value. */
const miamiDade = arcgis({
  descriptor: {
    id: "fl-miami-dade",
    label: "Miami-Dade County, FL",
    state: "FL", county: "Miami-Dade", jurisdiction: "Miami-Dade County",
    cadence: "daily",
    capabilities: caps({ contractor: true, owner: true, jobValue: true }),
    notes: "Richest Florida schema: owner, contractor with phone, and estimated value.",
  },
  layerUrl: "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/miamidade_permit_data/FeatureServer/0",
  fields: {
    permit_number: "PermitNumber",
    address: "PropertyAddress",
    city: "City",
    description: "DetailDescriptionComments",
    permit_type: "ApplicationTypeDescription",
    status: "ApplicationTypeDescription",
    job_value: "EstimatedValue",
    file_date: "ApplicationDate",
    issue_date: "PermitIssuedDate",
    final_date: "CoCcDate",
    owner_name: "OwnerName",
    contractor_company: "ContractorName",
    contractor_license: "ContractorNumber",
    building_area: "SquareFootage",
    units: "StructureUnits",
  },
  maxRecordCount: 1000,
});

/** Highest-volume single Florida feed, refreshed several times a day. */
const orlando = socrata({
  descriptor: {
    id: "fl-orlando",
    label: "Orlando, FL",
    state: "FL", county: "Orange", city: "Orlando", jurisdiction: "City of Orlando",
    cadence: "realtime",
    capabilities: caps({ contractor: true, owner: true, jobValue: true, exactCount: false }),
    notes: "~700 filings a week, contractor with phone, owner and estimated cost. Does not cover unincorporated Orange County.",
  },
  domain: "data.cityoforlando.net",
  datasetId: "ryhf-m453",
  fields: {
    permit_number: "permit_number",
    address: "permit_address",
    description: "worktype",
    permit_type: "application_type",
    status: "application_status",
    job_value: "estimated_cost",
    file_date: "processed_date",
    issue_date: "issue_permit_date",
    final_date: "final_date",
    owner_name: "property_owner_name",
    contractor_company: "contractor_name",
    contractor_phone: "contractor_phone_number",
    building_area: "square_footage",
  },
  appTokenEnv: "SOCRATA_APP_TOKEN",
});

/** Fastest-growing city in Florida; same-day filings with value and contractor. */
const capeCoral = arcgis({
  descriptor: {
    id: "fl-cape-coral",
    label: "Cape Coral, FL",
    state: "FL", county: "Lee", city: "Cape Coral", jurisdiction: "Cape Coral",
    cadence: "realtime",
    capabilities: caps({ contractor: true, jobValue: true }),
    notes: "issuedate contains junk future values upstream; freshness is keyed off applydate.",
  },
  layerUrl: "https://capeims.capecoral.gov/arcgis/rest/services/OpenData/OpenData/MapServer/1",
  fields: {
    permit_number: "Permit_Number",
    address: "Addr1",
    city: "City",
    zipcode: "Zip",
    description: "permit_desc",
    permit_type: "Permit_Type",
    status: "permit_status",
    job_value: "permitvalue",
    file_date: "applydate",
    final_date: "finalizedate",
    contractor_company: "Company_Name",
    contractor_name: "Contractor",
  },
  maxRecordCount: 1000,
});

/** Accela extract for the Tampa metro; Tampa proper has no general feed. */
const hillsborough = arcgis({
  descriptor: {
    id: "fl-hillsborough",
    label: "Hillsborough County, FL",
    state: "FL", county: "Hillsborough", jurisdiction: "Hillsborough County",
    cadence: "daily",
    capabilities: caps({ jobValue: true, latLng: true }),
    notes: "Covers the Tampa metro better than the City of Tampa's own feed. No contractor or owner reported.",
  },
  layerUrl: "https://services.arcgis.com/apTfC6SUmnNfnxuF/ArcGIS/rest/services/AccelaDashBoard_MapService20211019_view/FeatureServer/0",
  fields: {
    permit_number: "PERMIT__",
    address: "ADDRESS",
    city: "CITY_1",
    description: "DESCRIPTION",
    permit_type: "TYPE2",
    status: "STATUS_1",
    job_value: "Value",
    issue_date: "ISSUED_DATE",
    final_date: "COMPLETE_DATE",
    building_area: "SF_Total",
    units: "Unit_Cnt",
  },
  maxRecordCount: 1000,
});

/**
 * Hillsborough site and subdivision development review.
 *
 * Site plans and subdivisions sit upstream of the building permit, and the rows
 * carry a developer contact and an acreage. For an excavation contractor this is
 * the strongest pure site-work signal in the registry.
 */
const hillsboroughSiteDev = arcgis({
  descriptor: {
    id: "fl-hillsborough-sitedev",
    label: "Hillsborough County site & subdivision review, FL",
    state: "FL", county: "Hillsborough", jurisdiction: "Hillsborough County",
    cadence: "weekly",
    capabilities: caps({ owner: true, latLng: true }),
    notes: "Site plans upstream of the building permit. Carries a developer contact and acreage.",
  },
  layerUrl: "https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/Site-Subdivision_DevReview_View/FeatureServer/0",
  fields: {
    permit_number: "ProjectName",
    description: "ProjectType",
    permit_type: "ApplicationType",
    status: "ReviewStatus",
    file_date: "SubmissionDate",
    issue_date: "ReviewApprovalDate",
    owner_name: "ContactLast",
    units: "TotalResUnits",
  },
  maxRecordCount: 1000,
});

/** 549k rows with job value. Dates are strings upstream, so no INTERVAL syntax. */
const manatee = arcgis({
  descriptor: {
    id: "fl-manatee",
    label: "Manatee County, FL",
    state: "FL", county: "Manatee", jurisdiction: "Manatee County",
    cadence: "daily",
    capabilities: caps({ owner: true, jobValue: true }),
    notes: "Applicant arrives split across first and last name columns; a company name lands in the surname column.",
  },
  layerUrl: "https://www.mymanatee.org/gisbads/rest/services/Permit/permitlinks/MapServer/1",
  dateAsString: true,
  fields: {
    permit_number: "PERMITNUM",
    address: "STREETNAME",
    city: "CITY",
    description: "NOTE",
    permit_type: "PERMITTYPE",
    status: "B1_APPL_STATUS",
    job_value: "JOBVALUE",
    file_date: "APPLYDATE",
    issue_date: "ISSUED",
    // Manatee splits the applicant; the surname column alone reads as "De Jesus".
    owner_first_name: "APPLICANTFNAME",
    owner_last_name: "APPLICANTLNAME",
    units: "NUMOFUNITS",
  },
  maxRecordCount: 1000,
});

/** Freshest feed in the set - timestamped to the minute. */
const volusia = arcgis({
  descriptor: {
    id: "fl-volusia",
    label: "Volusia County, FL",
    state: "FL", county: "Volusia", jurisdiction: "Volusia County",
    cadence: "realtime",
    capabilities: caps({ latLng: true }),
    notes: "Rolling active projects only. No job value, contractor or owner.",
  },
  layerUrl: "https://maps5.vcgov.org/arcgis/rest/services/CurrentProjects/MapServer/1",
  fields: {
    permit_number: "REFERENCEFILE",
    address: "FOLDERNAME",
    description: "FOLDERDESCRIPTION",
    permit_type: "FOLDERTYPE",
    status: "STATUSDESC",
    file_date: "INDATE",
  },
  maxRecordCount: 1000,
});

/** Kissimmee / St. Cloud growth corridor; new construction only, with value. */
const osceolaCommercial = arcgis({
  descriptor: {
    id: "fl-osceola-commercial",
    label: "Osceola County commercial new construction, FL",
    state: "FL", county: "Osceola", jurisdiction: "Osceola County",
    cadence: "daily",
    capabilities: caps({ jobValue: true, latLng: true }),
  },
  layerUrl: "https://services6.arcgis.com/9zKHLCgIwu2HFA5O/arcgis/rest/services/New_Construction_P_Permits/FeatureServer/6",
  fields: {
    permit_number: "Record_ID",
    address: "Full_Address",
    description: "Description",
    permit_type: "SubType",
    status: "Record_Status",
    job_value: "Construction_Value",
    file_date: "File_Date",
    building_area: "TotalSquareFootage",
    units: "NumberofUnits",
  },
  maxRecordCount: 1000,
});

const osceolaResidential = arcgis({
  descriptor: {
    id: "fl-osceola-residential",
    label: "Osceola County residential new construction, FL",
    state: "FL", county: "Osceola", jurisdiction: "Osceola County",
    cadence: "daily",
    capabilities: caps({ jobValue: true, latLng: true }),
  },
  layerUrl: "https://services6.arcgis.com/9zKHLCgIwu2HFA5O/arcgis/rest/services/New_Construction_A_Permits/FeatureServer/7",
  fields: {
    permit_number: "Record_ID",
    address: "Full_Address",
    description: "Description",
    permit_type: "SubType",
    status: "Record_Status",
    job_value: "Construction_Value",
    file_date: "File_Date",
    property_type: "Permit_For",
  },
  maxRecordCount: 1000,
});

/** Replaces the dead City of Gainesville Socrata dataset. */
const alachua = arcgis({
  descriptor: {
    id: "fl-alachua",
    label: "Alachua County (Gainesville), FL",
    state: "FL", county: "Alachua", jurisdiction: "Alachua County",
    cadence: "daily",
    capabilities: caps({ contractor: true, owner: true, latLng: true }),
    notes: "Use instead of the City of Gainesville Socrata dataset, which froze in 2023. No job value.",
  },
  layerUrl: "https://services1.arcgis.com/MiBZ4u97DWldovjI/arcgis/rest/services/BuildingPermitsCS/FeatureServer/0",
  fields: {
    permit_number: "Permit",
    address: "FULLADDR",
    description: "WorkDescription",
    permit_type: "Permit_Type",
    status: "Status",
    file_date: "ApplicationDate",
    issue_date: "IssueDate",
    final_date: "CloseDate",
    owner_name: "OwnerName",
    contractor_company: "LicensedContractorName",
    contractor_name: "ApplicanName",
  },
  maxRecordCount: 1000,
});

const charlotte = arcgis({
  descriptor: {
    id: "fl-charlotte",
    label: "Charlotte County, FL",
    state: "FL", county: "Charlotte", jurisdiction: "Charlotte County",
    cadence: "daily",
    capabilities: caps({ owner: true }),
    notes: "Record types include code enforcement; those are filtered out. No job value.",
  },
  layerUrl: "https://agis3.charlottecountyfl.gov/arcgis/rest/services/Internal/CCGIS_ComDev_Internal/MapServer/159",
  baseWhere: "RECORD_TYPE NOT LIKE '%Code%'",
  fields: {
    permit_number: "RECORD_ID",
    address: "ADDR_FULL_LINE_",
    zipcode: "ZIPCODE",
    description: "DESCRIPTION",
    permit_type: "RECORD_TYPE",
    status: "RECORD_STATUS",
    file_date: "DATE_OPENED",
    owner_name: "BUSINESS_NAME",
  },
  maxRecordCount: 1000,
});

/** Good schema and cost breakdown, but filings surface on roughly a 10-day lag. */
const cityOfMiami = arcgis({
  descriptor: {
    id: "fl-city-of-miami",
    label: "City of Miami, FL",
    state: "FL", county: "Miami-Dade", city: "Miami", jurisdiction: "City of Miami",
    cadence: "daily",
    capabilities: caps({ contractor: true, jobValue: true, latLng: true }),
    notes: "Filings surface about 10 days after submission, so narrow date windows under-count.",
  },
  layerUrl: "https://services1.arcgis.com/CvuPhqcTQpZPT9qY/arcgis/rest/services/Building_Permits_Since_2014/FeatureServer/0",
  fields: {
    permit_number: "PermitNumber",
    address: "DeliveryAddress",
    description: "ScopeofWork",
    permit_type: "PropertyType",
    status: "BuildingPermitStatusDescription",
    job_value: "TotalCost",
    file_date: "FirstSubmissionDate",
    issue_date: "IssuedDate",
    final_date: "Certificatedate",
    contractor_company: "CompanyName",
    building_area: "TotalSQFT",
  },
  maxRecordCount: 1000,
});

/* ═══════════════════════════════════════════════════════════════════════════
   TEXAS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Best Texas source, and the only feed with an explicit grading permit type. */
const fortWorth = arcgis({
  descriptor: {
    id: "tx-fort-worth",
    label: "Fort Worth, TX",
    state: "TX", county: "Tarrant", city: "Fort Worth", jurisdiction: "City of Fort Worth",
    cadence: "realtime",
    capabilities: caps({ owner: true, jobValue: true }),
    notes: "Permit types include 'Commercial Grading Permit'. Same-day filings, ~1,200 a week.",
  },
  layerUrl: "https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/FeatureServer/0",
  fields: {
    permit_number: "Permit_No",
    address: "Full_Street_Address",
    zipcode: "Zip_Code",
    description: "B1_WORK_DESC",
    permit_type: "Permit_Type",
    status: "Current_Status",
    job_value: "JobValue",
    file_date: "File_Date",
    owner_name: "Owner_Full_Name",
    building_area: "SqFt",
    units: "Units",
  },
  maxRecordCount: 1000,
});

const sanAntonio = arcgis({
  descriptor: {
    id: "tx-san-antonio",
    label: "San Antonio, TX",
    state: "TX", county: "Bexar", city: "San Antonio", jurisdiction: "City of San Antonio",
    cadence: "daily",
    capabilities: caps({ owner: true, jobValue: true, latLng: true }),
    notes: "Declared valuation is sparsely populated.",
  },
  layerUrl: "https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/Permits_Issued/FeatureServer/0",
  fields: {
    permit_number: "Permit_Number",
    address: "Address",
    description: "Project_Name",
    permit_type: "Permit_Type",
    job_value: "Declared_Valuation",
    file_date: "Date_Submitted",
    issue_date: "Date_Issued",
    owner_name: "Primary_Contact",
    building_area: "Area_SF",
  },
  maxRecordCount: 1000,
});

const austin = socrata({
  descriptor: {
    id: "tx-austin",
    label: "Austin, TX",
    state: "TX", county: "Travis", city: "Austin", jurisdiction: "City of Austin",
    cadence: "daily",
    capabilities: caps({ contractor: true, owner: true, exactCount: false }),
    notes: "Issued permits, so an applied-date window under-counts. Contractor ~92% filled; the applicant field is only ~20% and there is no owner.",
  },
  domain: "datahub.austintexas.gov",
  datasetId: "3syk-w9eu",
  fields: {
    permit_number: "permit_number",
    address: "original_address1",
    city: "original_city",
    zipcode: "original_zip",
    description: "description",
    permit_type: "permit_type_desc",
    status: "status_current",
    file_date: "applieddate",
    issue_date: "issue_date",
    property_type: "permit_class_mapped",
    // These exist and are ~92% filled. An earlier mapping missed them because
    // Socrata omits null keys from row JSON, so sampling a row with a null
    // contractor makes the column look absent. Read /api/views/<id>.json.
    contractor_company: "contractor_company_name",
    contractor_name: "contractor_full_name",
    contractor_phone: "contractor_phone",
    owner_name: "applicant_full_name",
  },
  appTokenEnv: "SOCRATA_APP_TOKEN",
});

/** The only Texas appraisal district publishing permits, and it names the builder. */
const collinCad = socrata({
  descriptor: {
    id: "tx-collin-cad",
    label: "Collin County (Plano/Frisco/McKinney), TX",
    state: "TX", county: "Collin", jurisdiction: "Collin CAD",
    cadence: "daily",
    capabilities: caps({ contractor: true, owner: true, jobValue: true, exactCount: false }),
    notes: "Names the builder directly, which most Texas feeds do not.",
  },
  domain: "data.texas.gov",
  datasetId: "82ee-gbj5",
  fields: {
    permit_number: "permitnum",
    address: "situsconcat",
    city: "situscity",
    zipcode: "situszip",
    description: "permitcomments",
    permit_type: "permittypedescr",
    job_value: "permitvalue",
    issue_date: "permitissueddate",
    owner_name: "propownername",
    contractor_company: "permitbuildername",
    building_area: "permitbldgarea",
  },
  appTokenEnv: "SOCRATA_APP_TOKEN",
});

/* ═══════════════════════════════════════════════════════════════════════════
   OTHER HIGH-VOLUME METROS
   ═══════════════════════════════════════════════════════════════════════════ */

const losAngeles = socrata({
  descriptor: {
    id: "ca-los-angeles",
    label: "Los Angeles, CA",
    state: "CA", county: "Los Angeles", city: "Los Angeles", jurisdiction: "LADBS",
    cadence: "daily",
    capabilities: caps({ jobValue: true, exactCount: false }),
    notes: "No contractor or owner; join CSLB licence data on address to recover the firm.",
  },
  domain: "data.lacity.org",
  datasetId: "pi9x-tg5x",
  fields: {
    permit_number: "permit_nbr",
    address: "primary_address",
    zipcode: "zip_code",
    description: "work_desc",
    permit_type: "permit_type",
    status: "status_desc",
    job_value: "valuation",
    issue_date: "issue_date",
    property_type: "use_desc",
    latitude: "lat",
    longitude: "lon",
  },
  appTokenEnv: "SOCRATA_APP_TOKEN",
});

const chicago = socrata({
  descriptor: {
    id: "il-chicago",
    label: "Chicago, IL",
    state: "IL", county: "Cook", city: "Chicago", jurisdiction: "City of Chicago",
    cadence: "daily",
    capabilities: caps({ contractor: true, jobValue: true, exactCount: false, latLng: true }),
  },
  domain: "data.cityofchicago.org",
  datasetId: "ydr8-5enu",
  fields: {
    permit_number: "permit_",
    address: "street_number",
    description: "work_description",
    permit_type: "permit_type",
    job_value: "reported_cost",
    file_date: "application_start_date",
    issue_date: "issue_date",
    contractor_name: "contact_1_name",
    latitude: "latitude",
    longitude: "longitude",
  },
  appTokenEnv: "SOCRATA_APP_TOKEN",
});

const cincinnati = socrata({
  descriptor: {
    id: "oh-cincinnati",
    label: "Cincinnati, OH",
    state: "OH", county: "Hamilton", city: "Cincinnati", jurisdiction: "City of Cincinnati",
    cadence: "daily",
    capabilities: caps({ contractor: true, jobValue: true, exactCount: false }),
  },
  domain: "data.cincinnati-oh.gov",
  datasetId: "uhjb-xac9",
  fields: {
    permit_number: "permitnum",
    address: "originaladdress1",
    city: "originalcity",
    zipcode: "originalzip",
    description: "description",
    permit_type: "permitclass",
    status: "statuscurrent",
    job_value: "estprojectcostdec",
    file_date: "applieddate",
    issue_date: "issueddate",
    contractor_company: "companyname",
  },
  appTokenEnv: "SOCRATA_APP_TOKEN",
});

const batonRouge = socrata({
  descriptor: {
    id: "la-baton-rouge",
    label: "Baton Rouge, LA",
    state: "LA", county: "East Baton Rouge", city: "Baton Rouge", jurisdiction: "City of Baton Rouge",
    cadence: "daily",
    capabilities: caps({ contractor: true, jobValue: true, exactCount: false }),
  },
  domain: "data.brla.gov",
  datasetId: "7fq7-8j7r",
  fields: {
    permit_number: "permitnumber",
    address: "streetaddress",
    city: "city1",
    zipcode: "zip",
    county: "parishname",
    description: "projectdescription",
    permit_type: "permittype",
    job_value: "projectvalue",
    fees: "permitfee",
    file_date: "creationdate",
    issue_date: "issueddate",
    contractor_company: "contractorname",
    owner_name: "applicantname",
    building_area: "squarefootage",
  },
  appTokenEnv: "SOCRATA_APP_TOKEN",
});


/**
 * City of Phoenix planning permits.
 *
 * The standout source in the whole registry. `PROFESS_NAME` holds the
 * professional of record, and on 1,987 open permits its literal value is
 * "TO BE BID" - an explicit, machine-readable statement that the grading
 * contractor has not been selected. Everywhere else we infer "no GC yet"
 * from a null field; here the jurisdiction says it outright.
 *
 * Phoenix's CKAN portal publishes only aggregate counts, which is why this
 * server is easy to miss. It is unlisted but public and needs no key.
 */
const phoenix = arcgis({
  descriptor: {
    id: "az-phoenix",
    label: "Phoenix, AZ",
    state: "AZ", county: "Maricopa", city: "Phoenix", jurisdiction: "City of Phoenix",
    cadence: "daily",
    capabilities: caps({ contractor: true }),
    notes: "PROFESS_NAME = 'TO BE BID' marks an open permit with no contractor selected - the clearest pre-award signal in the registry.",
  },
  layerUrl: "https://maps.phoenix.gov/pub/rest/services/Public/Planning_Permit/MapServer/1",
  timeoutMs: 90_000,
  fields: {
    permit_number: "PER_NUM",
    address: "STREET_FULL_NAME",
    description: "PERMIT_NAME",
    permit_type: "SCOPE_DESC",
    status: "PERMIT_STAT",
    file_date: "PER_ENT_DATE",
    issue_date: "PER_ISSUE_DATE",
    contractor_company: "PROFESS_NAME",
  },
  maxRecordCount: 1000,
});

/**
 * NYC Department of Buildings, DOB NOW job filings.
 *
 * The largest fresh feed in the registry and the only one where excavation is
 * a native boolean rather than a keyword guess: `earth_work_work_type_` and
 * `foundation_work_type_` are YES/NO columns. Owner first and last name are
 * filled on essentially every 2026 filing.
 *
 * Two cautions. `owner_s_business_name` is roughly a third placeholder text
 * ("Not Applicable", "PR", "N/A"), so the individual name fields are the
 * reliable key. And this is DOB NOW, not the legacy BIS dataset, which stores
 * its dates as text and is winding down.
 */
const nycDobNow = socrata({
  descriptor: {
    id: "ny-nyc-dobnow",
    label: "New York City (DOB NOW)",
    state: "NY", county: "New York", city: "New York", jurisdiction: "NYC Dept of Buildings",
    cadence: "realtime",
    capabilities: caps({ owner: true, contractor: true, jobValue: true, exactCount: false }),
    notes: "Excavation and foundation are native YES/NO fields. Owner business name is ~36% placeholder text; the personal name fields are reliable.",
  },
  domain: "data.cityofnewyork.us",
  datasetId: "w9ak-ipjd",
  timeoutMs: 60_000,
  fields: {
    permit_number: "job_filing_number",
    address_parts: { number: "house_no", street: "street_name" },
    city: "borough",
    description: "job_description",
    permit_type: "job_type",
    status: "filing_status",
    job_value: "initial_cost",
    file_date: "filing_date",
    owner_name: "owner_s_business_name",
    contractor_company: "applicant_business_name",
    contractor_license: "applicant_license",
  },
  appTokenEnv: "SOCRATA_APP_TOKEN",
});

/**
 * Raleigh development plans.
 *
 * The earliest signal in the registry: a plan is submitted months before any
 * permit, and the file names a `developer` on 95.8% of rows with the site
 * acreage attached.
 *
 * Worth knowing: `developer` frequently holds the civil engineer of record
 * rather than the equity developer. For a site-work contractor that is
 * arguably the better call anyway, since the civil engineer scopes the
 * earthwork. Volume is low - roughly three a week.
 */
const raleighPlans = arcgis({
  descriptor: {
    id: "nc-raleigh-plans",
    label: "Raleigh development plans, NC",
    state: "NC", county: "Wake", city: "Raleigh", jurisdiction: "City of Raleigh",
    cadence: "weekly",
    capabilities: caps({ owner: true, latLng: true }),
    notes: "Pre-application. Names a developer with acreage months before a permit; often the civil engineer of record.",
  },
  layerUrl: "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Development_Plans/FeatureServer/0",
  fields: {
    permit_number: "plan_number",
    description: "plan_name",
    permit_type: "plan_type",
    status: "status",
    file_date: "submitted",
    owner_company: "developer",
    units: "units_req",
  },
  maxRecordCount: 1000,
});

/**
 * Raleigh building permits still under review.
 *
 * Structurally the lead we want: 38% of these name no contractor yet, so the
 * trade package is open, and the parcel owner is named on 93% of rows.
 */
const raleighPending = arcgis({
  descriptor: {
    id: "nc-raleigh-pending",
    label: "Raleigh permits under review, NC",
    state: "NC", county: "Wake", city: "Raleigh", jurisdiction: "City of Raleigh",
    cadence: "daily",
    capabilities: caps({ owner: true, contractor: true, jobValue: true, latLng: true }),
    notes: "Pre-issuance only. Around 38% name no contractor yet, which is exactly the open trade package.",
  },
  layerUrl: "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Building_Permits_Pending/FeatureServer/0",
  fields: {
    permit_number: "permitnum",
    address: "originaladdress1",
    city: "originalcity",
    zipcode: "originalzip",
    description: "proposedworkdescription",
    permit_type: "permitclass",
    status: "statuscurrent",
    job_value: "estprojectcost",
    file_date: "applieddate",
    issue_date: "issueddate",
    owner_name: "parcelownername",
    contractor_company: "contractorcompanyname",
    contractor_license: "contractorlicnum",
    contractor_phone: "contractorphone",
  },
  maxRecordCount: 1000,
});

/**
 * Mecklenburg County (Charlotte) Accela extract.
 *
 * Owner named on 94% of rows and no contractor field at all, which makes every
 * row structurally a leading indicator. Contact fields exist but are populated
 * on a few hundred rows out of 215k, so treat them as absent.
 */
const mecklenburg = arcgis({
  descriptor: {
    id: "nc-mecklenburg",
    label: "Mecklenburg County (Charlotte), NC",
    state: "NC", county: "Mecklenburg", jurisdiction: "Mecklenburg County",
    cadence: "realtime",
    capabilities: caps({ owner: true, jobValue: true, latLng: true }),
    notes: "Owner-side only, 94% named, no contractor field. Owner phone and email exist but are filled on ~0.1% of rows.",
  },
  layerUrl: "https://meckgis.mecklenburgcountync.gov/server/rest/services/AccelaAllPermits/FeatureServer/0",
  fields: {
    permit_number: "permit_number",
    address: "project_address",
    city: "owner_city",
    zipcode: "zip_code",
    description: "description_of_work",
    permit_type: "permit_type",
    status: "permit_status",
    job_value: "building_construction_cost_customer",
    issue_date: "issue_date",
    final_date: "completion_date",
    owner_name: "owner_name",
    building_area: "total_square_feet",
    units: "number_of_units",
  },
  maxRecordCount: 1000,
});

/* ═══════════════════════════════════════════════════════════════════════════
   Archival - kept, and flagged, so nothing reads as a live lead
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * City of Gainesville building permits (Socrata).
 *
 * ARCHIVAL. Probed 2026-09-21: 96,691 rows but the newest issue date is
 * 2023-02-28 and every permit dataset on that domain is equally frozen. Useful
 * as a historical corpus and a clean schema reference; the live equivalent is
 * the Alachua County layer above.
 */
const gainesville = socrata({
  descriptor: {
    id: "fl-gainesville-socrata",
    label: "Gainesville, FL (archival)",
    state: "FL", county: "Alachua", city: "Gainesville", jurisdiction: "Gainesville",
    cadence: "unknown",
    capabilities: caps({ contractor: true, owner: true, exactCount: false, latLng: true }),
    notes: "ARCHIVAL: frozen at 2023-02-28. Historical only. Use Alachua County for live data.",
  },
  domain: "data.cityofgainesville.org",
  datasetId: "p798-x3nx",
  fields: {
    permit_number: "permit",
    address: "address",
    city: "city",
    description: "classification",
    permit_type: "type",
    contractor_company: "business",
    contractor_name: "contractor",
    owner_name: "primary_party",
    file_date: "submit",
    issue_date: "issue",
    latitude: "latitude",
    longitude: "longitude",
    location: "location_1",
  },
  appTokenEnv: "SOCRATA_APP_TOKEN",
});

/* ═══════════════════════════════════════════════════════════════════════════
   National fallback
   ═══════════════════════════════════════════════════════════════════════════ */

/** Breadth, not freshness. Only runs when a Shovels key is configured. */
const shovels = createShovelsAdapter();

/** Sources known to be stale; the UI says so rather than implying a quiet market. */
export const ARCHIVAL_SOURCE_IDS = new Set(["fl-gainesville-socrata"]);

export const ALL_SOURCES: SourceAdapter[] = [
  // Florida
  fdepErp, miamiDade, orlando, capeCoral, hillsborough, hillsboroughSiteDev,
  manatee, volusia, osceolaCommercial, osceolaResidential, alachua, charlotte, cityOfMiami,
  // Texas
  fortWorth, sanAntonio, austin, collinCad,
  // Highest-intent pre-award signals
  phoenix, nycDobNow, raleighPlans, raleighPending, mecklenburg,
  // Other metros
  losAngeles, chicago, cincinnati, batonRouge,
  // Archival
  gainesville,
  // National
  shovels,
];

export function selectSources(
  matches: (adapter: SourceAdapter) => boolean,
  opts: { includeArchival?: boolean } = {},
): SourceAdapter[] {
  const { includeArchival = true } = opts;
  return ALL_SOURCES.filter((adapter) => {
    if (!includeArchival && ARCHIVAL_SOURCE_IDS.has(adapter.descriptor.id)) return false;
    return matches(adapter);
  });
}

export function sourceById(id: string): SourceAdapter | undefined {
  return ALL_SOURCES.find((a) => a.descriptor.id === id);
}

/** States with at least one live (non-archival) source configured. */
export function coveredStates(): string[] {
  return [...new Set(
    ALL_SOURCES
      .filter((a) => !ARCHIVAL_SOURCE_IDS.has(a.descriptor.id) && a.descriptor.state !== "*")
      .map((a) => a.descriptor.state),
  )].sort();
}
