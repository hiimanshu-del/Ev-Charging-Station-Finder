// ============================================================
// EV CHARGING STATION FINDER
// Main JavaScript
// ============================================================

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------

const PAGE_SIZE = 10;
const MAX_STATIONS_ON_SCREEN = 200;

// Only nearest candidates are sent to OSRM.
// This keeps the application responsive with large datasets.
const ROAD_DISTANCE_CANDIDATES = 50;

const DEFAULT_UTILIZATION = 60;

const OSRM_TABLE_URL =
    "https://router.project-osrm.org/table/v1/driving/";


// ------------------------------------------------------------
// Global State
// ------------------------------------------------------------

let allStations = [];
let currentResultSet = [];
let currentVisibleCount = PAGE_SIZE;

let map = null;
let mapMarkers = [];
let currentLocationMarker = null;

// This is populated ONLY when browser GPS succeeds.
// There is no Patna/Samastipur default location.
let userLocation = null;

// Current search/filter context.
let activeSearchQuery = "";

// Stations currently visible on the page.
let displayedStations = [];


// ============================================================
// PAGE START
// ============================================================

document.addEventListener("DOMContentLoaded", async function () {

    // --------------------------------------------------------
    // Initialize the Leaflet map.
    // --------------------------------------------------------
    initializeMap();

    // --------------------------------------------------------
    // Enable search using the Enter key.
    // --------------------------------------------------------
    setupEnterKeySearch();

const predictButton = document.getElementById("predictButton");

if (predictButton) {
    predictButton.addEventListener("click", predictLoad);
}




    // Activate station filters when a selection changes.
[
    "statusFilter",
    "availabilityFilter",
    "chargerFilter"
].forEach(function (id) {

    const filterElement =
        document.getElementById(id);

    if (filterElement) {
        filterElement.addEventListener(
            "change",
            applyFilters
        );
    }
});

    // --------------------------------------------------------
    // Connect the Search button to the search function.
    // --------------------------------------------------------
    const searchButton = document.getElementById("searchButton");

    if (searchButton) {
        searchButton.addEventListener("click", function () {
            searchLocation();
        });
    }

    // --------------------------------------------------------
    // Connect the Nearby button to the current-location
    // based station finder.
    // --------------------------------------------------------
    const nearbyButton = document.getElementById("nearbyButton");

    if (nearbyButton) {
        nearbyButton.addEventListener("click", function () {
            findNearbyStations();
        });
    }

    // --------------------------------------------------------
    // Connect the "Use My Location" button.
    // --------------------------------------------------------
    const locationButton = document.getElementById("locationButton");

    if (locationButton) {
        locationButton.addEventListener("click", function () {
            findNearbyStations();
        });
    }

    // --------------------------------------------------------
    // Load station database.
    // --------------------------------------------------------
    await loadStations();
});


// ============================================================
// LOCATION
// ============================================================

function requestUserLocation() {

    return new Promise(function (resolve) {

        if (!navigator.geolocation) {

            console.warn(
                "Geolocation is not supported by this browser."
            );

            userLocation = null;

            showLocationMessage(
                "📍 GPS is not supported by this browser."
            );

            resolve(false);
            return;
        }

        navigator.geolocation.getCurrentPosition(

            function (position) {

                userLocation = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };

                console.log(
                    "Real GPS location:",
                    userLocation
                );

                showLocationMessage(
                    "📍 Your current GPS location detected."
                );

                if (allStations.length > 0) {

                    // Do not override an active search.
                    if (!activeSearchQuery) {
                        prepareStationsForDisplay();
                    }
                }

                resolve(true);
            },

            function (error) {

                console.warn(
                    "GPS error:",
                    error.message
                );

                userLocation = null;

                if (error.code === 1) {

                    showLocationMessage(
                        "📍 Location permission denied. Search a city or district."
                    );

                } else {

                    showLocationMessage(
                        "📍 GPS unavailable. Search a city or district."
                    );
                }

                resolve(false);
            },

            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 60000
            }
        );
    });
}


// ------------------------------------------------------------
// Location Message
// ------------------------------------------------------------

function showLocationMessage(message) {

    const resultInfo =
        document.getElementById("resultInfo");

    if (!resultInfo) {
        return;
    }

    resultInfo.innerHTML = message;
}


// ============================================================
// MAP
// ============================================================

function initializeMap() {

    // Neutral India-wide map.
    // No city is treated as the current location.
    map = L.map("map").setView(
        [20.5937, 78.9629],
        5
    );

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution:
                "&copy; OpenStreetMap contributors"
        }
    ).addTo(map);
}


// ============================================================
// LOAD STATIONS
// ============================================================

async function loadStations() {

    showStationLoading(true);

    try {

        const response =
            await fetch("/api/stations");

        const data =
            await response.json();

        if (!response.ok || data.success === false) {

            throw new Error(
                data.message ||
                "Unable to load stations."
            );
        }

        allStations =
            Array.isArray(data)
                ? data
                : (data.stations || []);

        console.log(
            "Stations loaded:",
            allStations.length
        );

        updateDashboard();

        populateChargerFilter();

        populatePredictorStations();

        activeSearchQuery = "";

        currentResultSet =
            allStations.filter(function (station) {

                return isValidCoordinate(
                    station.latitude,
                    station.longitude
                );
            });

        currentVisibleCount = PAGE_SIZE;

        displayStations();

        showStationLoading(false);

        // If real GPS is already available,
        // calculate nearby road distances in background.
        if (userLocation) {
            prepareStationsForDisplay();
        }

    } catch (error) {

        console.error(
            "Station loading error:",
            error
        );

        const stationList =
            document.getElementById("stationList");

        if (stationList) {

            stationList.innerHTML = `
                <div class="no-stations">
                    ❌ Unable to load charging stations.
                    <br>
                    ${escapeHtml(error.message)}
                </div>
            `;
        }

        showStationLoading(false);
    }
}


// ============================================================
// PREPARE STATIONS FOR CURRENT GPS
// ============================================================

async function prepareStationsForDisplay() {

    // Never use GPS when a search is active.
    if (
        !userLocation ||
        allStations.length === 0 ||
        activeSearchQuery
    ) {
        return;
    }

    let stations =
        [...allStations].filter(function (station) {

            return isValidCoordinate(
                station.latitude,
                station.longitude
            );
        });

    if (stations.length === 0) {
        return;
    }

    showLocationMessage(
        "📍 Finding nearby charging stations..."
    );

    // --------------------------------------------------------
    // Step 1: Calculate straight-line distance.
    // --------------------------------------------------------

    stations.forEach(function (station) {

        station.air_distance_m =
            calculateHaversineDistance(
                userLocation.latitude,
                userLocation.longitude,
                Number(station.latitude),
                Number(station.longitude)
            );

        station.road_distance_m = null;
        station.road_duration_s = null;
    });

    // --------------------------------------------------------
    // Step 2: Select nearest candidates.
    // --------------------------------------------------------

    stations.sort(function (a, b) {

        return (
            a.air_distance_m -
            b.air_distance_m
        );
    });

    const candidates =
        stations.slice(
            0,
            ROAD_DISTANCE_CANDIDATES
        );

    // --------------------------------------------------------
    // Step 3: Get actual road distances.
    // --------------------------------------------------------

    await calculateRoadDistanceBatch(
        candidates
    );

    // --------------------------------------------------------
    // Step 4: Sort by actual road distance.
    // --------------------------------------------------------

    candidates.sort(function (a, b) {

        const distanceA =
            Number.isFinite(a.road_distance_m)
                ? a.road_distance_m
                : a.air_distance_m;

        const distanceB =
            Number.isFinite(b.road_distance_m)
                ? b.road_distance_m
                : b.air_distance_m;

        return distanceA - distanceB;
    });

    currentResultSet = candidates;

    currentVisibleCount = PAGE_SIZE;

    showLocationMessage(
        "📍 Showing stations near your current GPS location."
    );

    displayStations();
}


// ============================================================
// ROAD DISTANCE
// ============================================================

async function calculateRoadDistanceBatch(stations) {

    if (
        !userLocation ||
        !stations ||
        stations.length === 0
    ) {
        return;
    }

    const coordinates = [

        `${userLocation.longitude},${userLocation.latitude}`,

        ...stations.map(function (station) {

            return (
                `${station.longitude},${station.latitude}`
            );
        })

    ].join(";");

    const destinations =
        stations.map(function (_, index) {

            return index + 1;

        }).join(";");

    const url =
        `${OSRM_TABLE_URL}${coordinates}` +
        `?sources=0` +
        `&destinations=${destinations}` +
        `&annotations=distance,duration`;

    try {

        const response =
            await fetch(url);

        if (!response.ok) {

            throw new Error(
                "Road distance service unavailable."
            );
        }

        const data =
            await response.json();

        if (data.code !== "Ok") {

            throw new Error(
                data.message ||
                "Road distance unavailable."
            );
        }

        const distances =
            data.distances &&
            data.distances[0]
                ? data.distances[0]
                : [];

        const durations =
            data.durations &&
            data.durations[0]
                ? data.durations[0]
                : [];

        stations.forEach(function (station, index) {

            const distance =
                distances[index];

            const duration =
                durations[index];

            if (
                typeof distance === "number" &&
                Number.isFinite(distance)
            ) {

                station.road_distance_m =
                    distance;
            }

            if (
                typeof duration === "number" &&
                Number.isFinite(duration)
            ) {

                station.road_duration_s =
                    duration;
            }
        });

    } catch (error) {

        console.warn(
            "Road distance unavailable:",
            error.message
        );
    }
}


// ============================================================
// HAVERSINE DISTANCE
// ============================================================

function calculateHaversineDistance(
    lat1,
    lon1,
    lat2,
    lon2
) {

    const earthRadius = 6371000;

    const lat1Rad =
        lat1 * Math.PI / 180;

    const lat2Rad =
        lat2 * Math.PI / 180;

    const deltaLat =
        (lat2 - lat1) * Math.PI / 180;

    const deltaLon =
        (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(deltaLat / 2) *
        Math.sin(deltaLat / 2) +

        Math.cos(lat1Rad) *
        Math.cos(lat2Rad) *
        Math.sin(deltaLon / 2) *
        Math.sin(deltaLon / 2);

    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return earthRadius * c;
}


// ============================================================
// DISPLAY STATIONS
// ============================================================

function displayStations() {

    const stationList =
        document.getElementById(
            "stationList"
        );

    const noStations =
        document.getElementById(
            "noStations"
        );

    if (!stationList) {
        return;
    }

    stationList.innerHTML = "";

    if (
        !currentResultSet ||
        currentResultSet.length === 0
    ) {

        if (noStations) {
            noStations.style.display = "block";
        }

        updateResultInfo(0);

        updateLoadMoreButton();

        clearMapMarkers();

        return;
    }

    if (noStations) {
        noStations.style.display = "none";
    }

    const visibleStations =
        currentResultSet.slice(
            0,
            Math.min(
                currentVisibleCount,
                MAX_STATIONS_ON_SCREEN
            )
        );

    visibleStations.forEach(function (station) {

        const card =
            createStationCard(station);

        stationList.appendChild(card);
    });

    displayedStations =
        visibleStations;

    updateResultInfo(
        visibleStations.length
    );

    updateLoadMoreButton();

    updateMapMarkers(
        visibleStations
    );
}


// ============================================================
// LOAD MORE
// ============================================================

function loadMoreStations() {

    currentVisibleCount += PAGE_SIZE;

    displayStations();
}


// ============================================================
// LOAD MORE BUTTON
// ============================================================

function updateLoadMoreButton() {

    const container =
        document.getElementById(
            "loadMoreContainer"
        );

    const button =
        document.getElementById(
            "loadMoreButton"
        );

    if (!container || !button) {
        return;
    }

    if (
        currentVisibleCount <
        Math.min(
            currentResultSet.length,
            MAX_STATIONS_ON_SCREEN
        )
    ) {

        container.style.display = "block";

        button.textContent =
            "⬇️ Load More";

    } else {

        container.style.display = "none";
    }
}


// ============================================================
// RESULT INFORMATION
// ============================================================

function updateResultInfo(count) {

    const resultInfo =
        document.getElementById(
            "resultInfo"
        );

    if (!resultInfo) {
        return;
    }

    const total =
        currentResultSet.length;

    // Search result.
    if (activeSearchQuery) {

        resultInfo.innerHTML = `
            🔎 <strong>${escapeHtml(activeSearchQuery)}</strong>
            <br>
            Showing ${count} of ${total} matching stations
        `;

        return;
    }

    // Real GPS result.
    if (userLocation) {

        resultInfo.innerHTML = `
            📍 <strong>Your current GPS location</strong>
            <br>
            Showing ${count} of ${total} nearby stations
            <br>
            <small>Sorted by road distance where available.</small>
        `;

        return;
    }

    // Normal initial state.
    resultInfo.innerHTML = `
        Showing ${count} of ${total} stations
        <br>
        <small>Search a city or district to find nearby stations.</small>
    `;
}


// ============================================================
// STATION CARD
// ============================================================

function createStationCard(station) {

    const card =
        document.createElement("div");

    card.className =
        "station-card";

    card.id =
        `station-card-${station.id}`;

    const name =
        station.name ||
        "Unnamed Charging Station";

    const district =
        station.district ||
        "Unknown District";

    const city =
        station.city ||
        "Unknown City";

    const state =
        station.state ||
        "Unknown State";

    const address =
        station.address ||
        "Address not available";

    const chargerType =
        station.charger_type ||
        "Not specified";

    const chargerRating =
        Number(
            station.charger_rating_kw
        );

    const connectorRating =
        Number(
            station.connector_rating_kw
        );

    const connectorCount =
        Number(
            station.connector_count
        );

    const status =
        normalizeStatus(
            station.status
        );

        const availability =
    normalizeAvailability(
        station.availability
    );

    const availabilityElement =
    document.getElementById(
        "availabilityFilter"
    );

    const operator =
        station.cpo_name ||
        "Not available";

    const source =
        station.source ||
        "BEE";

    const sourceDate =
        station.source_date ||
        "Unknown";

    const estimatedLoad =
        calculateEstimatedLoad(
            chargerRating
        );

    const statusClass =
        getStatusClass(status);

    const availabilityClass =
        getAvailabilityClass(
            availability
        );

    let roadDistanceHTML =
        "📍 Distance unavailable";

    if (
        Number.isFinite(
            station.road_distance_m
        )
    ) {

        roadDistanceHTML = `
            🚗 <strong>
                ${formatRoadDistance(
                    station.road_distance_m
                )}
            </strong>
            road distance
        `;

    } else if (
        Number.isFinite(
            station.air_distance_m
        )
    ) {

        roadDistanceHTML = `
            📍 About <strong>
                ${formatRoadDistance(
                    station.air_distance_m
                )}
            </strong>
            straight-line distance
        `;
    }

    card.innerHTML = `

        <div class="station-card-header">

            <div class="station-title-area">

                <h3>
                    ⚡ ${escapeHtml(name)}
                </h3>

                <div class="station-location">
                    📍
                    ${escapeHtml(city)},
                    ${escapeHtml(district)},
                    ${escapeHtml(state)}
                </div>

            </div>

            <div class="station-arrow">
                ›
            </div>

        </div>

        <div class="station-address">

            <strong>
                📍 Address
            </strong>

            <span>
                ${escapeHtml(address)}
            </span>

        </div>

        <div class="station-details-grid">

            <div class="detail-box">

                <span class="detail-label">
                    🔌 Charger Type
                </span>

                <span class="detail-value">
                    ${escapeHtml(chargerType)}
                </span>

            </div>

            <div class="detail-box">

                <span class="detail-label">
                    ⚡ Charger Rating
                </span>

                <span class="detail-value">
                    ${formatNumber(chargerRating)} kW
                </span>

            </div>

            <div class="detail-box">

                <span class="detail-label">
                    🔋 Connector Rating
                </span>

                <span class="detail-value">
                    ${formatNumber(connectorRating)} kW
                </span>

            </div>

            <div class="detail-box">

                <span class="detail-label">
                    🔌 Connectors
                </span>

                <span class="detail-value">
                    ${formatNumber(
                        connectorCount,
                        0
                    )}
                </span>

            </div>

            <div class="detail-box">

                <span class="detail-label">
                    Status
                </span>

                <span class="status-badge ${statusClass}">
                    ${escapeHtml(status)}
                </span>

            </div>

            <div class="detail-box">

                <span class="detail-label">
                    Availability
                </span>

                <span class="status-badge ${availabilityClass}">
                    ${escapeHtml(availability)}
                </span>

            </div>

            <div class="detail-box">

                <span class="detail-label">
                    📊 Estimated Load
                </span>

                <span class="detail-value">
                    ${formatNumber(
                        estimatedLoad
                    )} kW
                </span>

            </div>

            <div class="detail-box">

                <span class="detail-label">
                    🏢 Operator
                </span>

                <span class="detail-value">
                    ${escapeHtml(operator)}
                </span>

            </div>

        </div>

        <div class="road-distance">
            ${roadDistanceHTML}
        </div>

        <div class="station-source">

            Source:
            ${escapeHtml(source)}

            <span>•</span>

            Data date:
            ${escapeHtml(sourceDate)}

        </div>

        <div class="station-actions">

            <button
                type="button"
                class="action-button map-action">

                🗺️ View on Map

            </button>

            <button
                type="button"
                class="action-button direction-action">

                🚗 Directions

            </button>

        </div>
    `;

    // Whole card click.
    card.addEventListener(
        "click",
        function () {

            focusStation(
                station.id
            );

            highlightStationCard(
                station.id
            );
        }
    );

    // Map button.
    const mapButton =
        card.querySelector(
            ".map-action"
        );

    if (mapButton) {

        mapButton.addEventListener(
            "click",
            function (event) {

                event.stopPropagation();

                focusStation(
                    station.id
                );

                highlightStationCard(
                    station.id
                );
            }
        );
    }

    // Directions button.
    const directionButton =
        card.querySelector(
            ".direction-action"
        );

    if (directionButton) {

        directionButton.addEventListener(
            "click",
            function (event) {

                event.stopPropagation();

                openDirections(
                    station.latitude,
                    station.longitude
                );
            }
        );
    }

    return card;
}


// ============================================================
// STATUS
// ============================================================

function normalizeStatus(value) {

    if (
        value === null ||
        value === undefined ||
        String(value).trim() === ""
    ) {
        return "Unknown";
    }

    const text =
        String(value)
            .trim()
            .toLowerCase();

    if (
        text === "online" ||
        text === "active"
    ) {
        return "Online";
    }

    if (
        text === "offline" ||
        text === "inactive"
    ) {
        return "Offline";
    }

    return "Unknown";
}


// ============================================================
// AVAILABILITY
// ============================================================

function normalizeAvailability(value) {

    if (
        value === null ||
        value === undefined ||
        String(value).trim() === ""
    ) {
        return "Unknown";
    }

    const text =
        String(value)
            .trim()
            .toLowerCase();

    if (
        text === "available" ||
        text === "free"
    ) {
        return "Available";
    }

    if (
        text === "unavailable" ||
        text === "busy"
    ) {
        return "Unavailable";
    }

    return "Unknown";
}


// ============================================================
// STATUS CSS
// ============================================================

function getStatusClass(status) {

    switch (
        normalizeStatus(status)
    ) {

        case "Online":
            return "status-online";

        case "Offline":
            return "status-offline";

        default:
            return "status-unknown";
    }
}


// ============================================================
// AVAILABILITY CSS
// ============================================================

function getAvailabilityClass(
    availability
) {

    switch (
        normalizeAvailability(
            availability
        )
    ) {

        case "Available":
            return "availability-available";

        case "Unavailable":
            return "availability-unavailable";

        default:
            return "availability-unknown";
    }
}


// ============================================================
// FILTERS
// ============================================================

function populateChargerFilter() {

    const select =
        document.getElementById(
            "chargerFilter"
        );

    if (!select) {
        return;
    }

    const types =
        new Set();

    allStations.forEach(
        function (station) {

            if (station.charger_type) {

                types.add(
                    station.charger_type
                );
            }
        }
    );

    select.innerHTML = `
        <option value="all">
            All Charger Types
        </option>
    `;

    Array.from(types)
        .sort()
        .forEach(
            function (type) {

                const option =
                    document.createElement(
                        "option"
                    );

                option.value =
                    type;

                option.textContent =
                    type;

                select.appendChild(
                    option
                );
            }
        );
}


// ============================================================
// APPLY FILTERS
// ============================================================

function applyFilters() {

    const statusElement =
        document.getElementById(
            "statusFilter"
        );

    const availabilityElement =
    document.getElementById(
        "availabilityFilter"
    );

    const chargerElement =
        document.getElementById(
            "chargerFilter"
        );

    const statusFilter =
        statusElement
            ? statusElement.value
            : "all";

    const availabilityFilter =
        availabilityElement
            ? availabilityElement.value
            : "all";

    const chargerFilter =
        chargerElement
            ? chargerElement.value
            : "all";

    // IMPORTANT:
    // Filters are applied to the current search result
    // instead of always resetting to all stations.
    const baseStations =
        activeSearchQuery
            ? getSearchMatches(activeSearchQuery)
            : (
                userLocation
                    ? currentResultSet
                    : allStations
            );

    currentResultSet =
        baseStations.filter(
            function (station) {

                const status =
                    normalizeStatus(
                        station.status
                    ).toLowerCase();

                const availability =
                    normalizeAvailability(
                        station.availability
                    ).toLowerCase();

                const charger =
                    station.charger_type ||
                    "";

                return (

                    (
                        statusFilter === "all" ||
                        status === statusFilter
                    )

                    &&

                    (
                        availabilityFilter === "all" ||
                        availability === availabilityFilter
                    )

                    &&

                    (
                        chargerFilter === "all" ||
                        charger === chargerFilter
                    )
                );
            }
        );

    // Sort by available distance.
    if (userLocation) {

        currentResultSet.sort(
            function (a, b) {

                const distanceA =
                    Number.isFinite(
                        a.road_distance_m
                    )
                        ? a.road_distance_m
                        : (
                            Number.isFinite(
                                a.air_distance_m
                            )
                                ? a.air_distance_m
                                : Infinity
                        );

                const distanceB =
                    Number.isFinite(
                        b.road_distance_m
                    )
                        ? b.road_distance_m
                        : (
                            Number.isFinite(
                                b.air_distance_m
                            )
                                ? b.air_distance_m
                                : Infinity
                        );

                return (
                    distanceA -
                    distanceB
                );
            }
        );
    }

    currentVisibleCount =
        PAGE_SIZE;

    displayStations();
}


// ============================================================
// SEARCH HELPERS
// ============================================================

function getSearchMatches(query) {

    const searchText =
        String(query)
            .trim()
            .toLowerCase();

    return allStations.filter(
        function (station) {

            const name =
                String(station.name || "")
                    .toLowerCase();

            const city =
                String(station.city || "")
                    .toLowerCase();

            const district =
                String(station.district || "")
                    .toLowerCase();

            const state =
                String(station.state || "")
                    .toLowerCase();

            const address =
                String(station.address || "")
                    .toLowerCase();

            const operator =
                String(station.cpo_name || "")
                    .toLowerCase();

            return (
                name.includes(searchText) ||
                city.includes(searchText) ||
                district.includes(searchText) ||
                state.includes(searchText) ||
                address.includes(searchText) ||
                operator.includes(searchText)
            );
        }
    );
}


// ============================================================
// SEARCH LOCATION / STATIONS
// ============================================================

async function searchLocation() {

    const input =
        document.getElementById(
            "locationInput"
        );

    if (!input) {
        return;
    }

    const originalQuery =
        input.value.trim();

    if (!originalQuery) {

        alert(
            "Please enter a city, district or location."
        );

        return;
    }

    const query =
        originalQuery.toLowerCase();

    showStationLoading(true);

    try {

        // ----------------------------------------------------
        // STEP 1:
        // Search actual station database first.
        // ----------------------------------------------------

        const matchedStations =
            getSearchMatches(query);

        // ----------------------------------------------------
        // If matching stations are found.
        // ----------------------------------------------------

        if (matchedStations.length > 0) {

            activeSearchQuery =
                originalQuery;

            // Calculate straight-line distance from
            // searched station group to GPS only if available.
            if (userLocation) {

                matchedStations.forEach(
                    function (station) {

                        if (
                            isValidCoordinate(
                                station.latitude,
                                station.longitude
                            )
                        ) {

                            station.air_distance_m =
                                calculateHaversineDistance(
                                    userLocation.latitude,
                                    userLocation.longitude,
                                    Number(station.latitude),
                                    Number(station.longitude)
                                );
                        }
                    }
                );

                matchedStations.sort(
                    function (a, b) {

                        const distanceA =
                            Number.isFinite(
                                a.road_distance_m
                            )
                                ? a.road_distance_m
                                : (
                                    Number.isFinite(
                                        a.air_distance_m
                                    )
                                        ? a.air_distance_m
                                        : Infinity
                                );

                        const distanceB =
                            Number.isFinite(
                                b.road_distance_m
                            )
                                ? b.road_distance_m
                                : (
                                    Number.isFinite(
                                        b.air_distance_m
                                    )
                                        ? b.air_distance_m
                                        : Infinity
                                );

                        return (
                            distanceA -
                            distanceB
                        );
                    }
                );
            }

            currentResultSet =
                matchedStations;

            currentVisibleCount =
                PAGE_SIZE;

            displayStations();

            // Fit map to ALL matching stations.
            const validStations =
                matchedStations.filter(
                    function (station) {

                        return isValidCoordinate(
                            station.latitude,
                            station.longitude
                        );
                    }
                );

            if (validStations.length > 0) {

                const bounds =
                    L.latLngBounds(
                        validStations.map(
                            function (station) {

                                return [
                                    Number(
                                        station.latitude
                                    ),
                                    Number(
                                        station.longitude
                                    )
                                ];
                            }
                        )
                    );

                map.fitBounds(
                    bounds,
                    {
                        padding: [30, 30],
                        maxZoom: 13
                    }
                );
            }

            showLocationMessage(
                `🔎 ${matchedStations.length} station(s) found for "${originalQuery}".`
            );

            showStationLoading(false);

            return;
        }

        // ----------------------------------------------------
        // STEP 2:
        // No station text match.
        // Use geocoding for a general location.
        // ----------------------------------------------------

        const response =
            await fetch(
                `/api/geocode?q=${encodeURIComponent(
                    originalQuery
                )}`
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            data.success === false
        ) {

            throw new Error(
                data.message ||
                "Location not found."
            );
        }

        const latitude =
            Number(
                data.latitude ??
                data.lat
            );

        const longitude =
            Number(
                data.longitude ??
                data.lon
            );

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {

            throw new Error(
                "Location coordinates not available."
            );
        }

        // This is a SEARCHED location,
        // NOT the user's current location.
        map.setView(
            [
                latitude,
                longitude
            ],
            13
        );

        activeSearchQuery =
            originalQuery;

        // ----------------------------------------------------
        // Find nearest stations to SEARCHED location.
        // ----------------------------------------------------

        const nearbyStations =
            allStations
                .filter(
                    function (station) {

                        return isValidCoordinate(
                            station.latitude,
                            station.longitude
                        );
                    }
                )
                .map(
                    function (station) {

                        station.search_distance_m =
                            calculateHaversineDistance(
                                latitude,
                                longitude,
                                Number(station.latitude),
                                Number(station.longitude)
                            );

                        return station;
                    }
                )
                .sort(
                    function (a, b) {

                        return (
                            a.search_distance_m -
                            b.search_distance_m
                        );
                    }
                )
                .slice(0, 50);

        if (nearbyStations.length > 0) {

            currentResultSet =
                nearbyStations;

            currentVisibleCount =
                PAGE_SIZE;

            displayStations();

            showLocationMessage(
                `📍 Showing nearest stations around "${originalQuery}".`
            );

        } else {

            currentResultSet = [];

            displayStations();

            showLocationMessage(
                `❌ No charging stations found near "${originalQuery}".`
            );
        }

    } catch (error) {

        console.error(
            "Search error:",
            error
        );

        activeSearchQuery = "";

        alert(
            "Search failed: " +
            error.message
        );

    } finally {

        showStationLoading(false);
    }
}


// ============================================================
// CURRENT LOCATION BUTTON
// ============================================================

async function findNearbyStations() {

    const success =
        await requestUserLocation();

    if (!success) {

        alert(
            "Please allow browser location permission first."
        );

        return;
    }

    // Clear any active search.
    activeSearchQuery = "";

    if (currentLocationMarker) {

        map.removeLayer(
            currentLocationMarker
        );
    }

    currentLocationMarker =
        L.marker([
            userLocation.latitude,
            userLocation.longitude
        ])
        .addTo(map)
        .bindPopup(
            "📍 Your current GPS location"
        )
        .openPopup();

    map.setView(
        [
            userLocation.latitude,
            userLocation.longitude
        ],
        13
    );

    await prepareStationsForDisplay();
}


// ============================================================
// MAP MARKERS
// ============================================================

function updateMapMarkers(stations) {

    clearMapMarkers();

    stations.forEach(
        function (station) {

            if (
                !isValidCoordinate(
                    station.latitude,
                    station.longitude
                )
            ) {
                return;
            }

            const marker =
                L.marker([
                    Number(
                        station.latitude
                    ),
                    Number(
                        station.longitude
                    )
                ])
                .addTo(map);

            let distanceText = "";

            const distance =
                Number.isFinite(
                    station.road_distance_m
                )
                    ? station.road_distance_m
                    : (
                        Number.isFinite(
                            station.search_distance_m
                        )
                            ? station.search_distance_m
                            : station.air_distance_m
                    );

            if (
                Number.isFinite(distance)
            ) {

                distanceText = `
                    <br>
                    📏 ${formatRoadDistance(distance)}
                `;
            }

            marker.bindPopup(`
                <strong>
                    ⚡ ${escapeHtml(
                        station.name ||
                        "Charging Station"
                    )}
                </strong>

                <br>

                📍 ${escapeHtml(
                    station.city ||
                    ""
                )}

                <br>

                🔌 ${escapeHtml(
                    station.charger_type ||
                    "Unknown"
                )}

                <br>

                ⚡ ${formatNumber(
                    station.charger_rating_kw
                )} kW

                ${distanceText}

                <br><br>

                <button
                    type="button"
                    onclick="focusStation(${station.id})">

                    View Station

                </button>
            `);

            marker.on(
                "click",
                function () {

                    highlightStationCard(
                        station.id
                    );
                }
            );

            mapMarkers.push(
                {
                    stationId:
                        station.id,

                    marker:
                        marker
                }
            );
        }
    );
}


// ============================================================
// CLEAR MAP MARKERS
// ============================================================

function clearMapMarkers() {

    if (!map) {
        return;
    }

    mapMarkers.forEach(
        function (item) {

            map.removeLayer(
                item.marker
            );
        }
    );

    mapMarkers = [];
}


// ============================================================
// FOCUS STATION
// ============================================================

function focusStation(stationId) {

    const item =
        mapMarkers.find(
            function (entry) {

                return (
                    Number(entry.stationId) ===
                    Number(stationId)
                );
            }
        );

    const station =
        currentResultSet.find(
            function (entry) {

                return (
                    Number(entry.id) ===
                    Number(stationId)
                );
            }
        );

    if (!station) {
        return;
    }

    if (item) {

        map.setView(
            [
                Number(
                    station.latitude
                ),
                Number(
                    station.longitude
                )
            ],
            16,
            {
                animate: true
            }
        );

        item.marker.openPopup();
    }
}


// ============================================================
// HIGHLIGHT CARD
// ============================================================

function highlightStationCard(stationId) {

    document
        .querySelectorAll(
            ".station-card.selected"
        )
        .forEach(
            function (card) {

                card.classList.remove(
                    "selected"
                );
            }
        );

    const selectedCard =
        document.getElementById(
            `station-card-${stationId}`
        );

    if (!selectedCard) {
        return;
    }

    selectedCard.classList.add(
        "selected"
    );

    selectedCard.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
    });
}


// ============================================================
// DIRECTIONS
// ============================================================

function openDirections(
    latitude,
    longitude
) {

    const lat =
        Number(latitude);

    const lon =
        Number(longitude);

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
    ) {

        alert(
            "Station location is not available."
        );

        return;
    }

    const url =
        `https://www.google.com/maps/dir/?api=1` +
        `&destination=${lat},${lon}`;

    window.open(
        url,
        "_blank"
    );
}


// ============================================================
// LOAD PREDICTOR
// ============================================================

function populatePredictorStations() {

    const select =
        document.getElementById(
            "stationSelect"
        );

    if (!select) {
        return;
    }

    select.innerHTML = `
        <option value="">
            Select a station
        </option>
    `;

    allStations.forEach(
        function (station) {

            const option =
                document.createElement(
                    "option"
                );

            option.value =
                station.id;

            option.textContent =
                station.name ||
                `Station ${station.id}`;

            select.appendChild(
                option
            );
        }
    );
}


// ============================================================
// PREDICT LOAD
// ============================================================

async function predictLoad() {

    const stationSelect =
        document.getElementById(
            "stationSelect"
        );

    const utilizationInput =
        document.getElementById(
            "utilizationInput"
        );

    const result =
        document.getElementById(
            "predictionResult"
        );

    if (!stationSelect || !result) {
        return;
    }

    const stationId =
        stationSelect.value;

    const utilization =
        Number(
            utilizationInput.value
        );

    if (!stationId) {

        result.innerHTML =
            "⚠️ Please select a station.";

        return;
    }

    if (
        !Number.isFinite(utilization) ||
        utilization < 0 ||
        utilization > 100
    ) {

        result.innerHTML =
            "⚠️ Utilization must be between 0 and 100.";

        return;
    }

    try {

        result.innerHTML =
            "⏳ Calculating...";

        const response =
            await fetch(
                `/api/predict?station_id=${encodeURIComponent(
                    stationId
                )}&utilization=${encodeURIComponent(
                    utilization
                )}`
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            data.success === false
        ) {

            throw new Error(
                data.message ||
                "Prediction failed."
            );
        }

        result.innerHTML = `

            <div class="prediction-card">

                <h3>
                    📊 Estimated Charging Load
                </h3>

                <p>
                    <strong>
                        Station:
                    </strong>

                    ${escapeHtml(
                        data.station_name ||
                        "Selected Station"
                    )}
                </p>

                <p>
                    <strong>
                        Utilization:
                    </strong>

                    ${formatNumber(
                        data.utilization_percent
                    )}%
                </p>

                <p>
                    <strong>
                        Charger Power:
                    </strong>

                    ${formatNumber(
                        data.power_kw
                    )} kW
                </p>

                <p>
                    <strong>
                        Estimated Load:
                    </strong>

                    ${formatNumber(
                        data.predicted_load_kw
                    )} kW
                </p>

                <small>
                    ${escapeHtml(
                        data.note ||
                        "This is an estimate."
                    )}
                </small>

            </div>
        `;

    } catch (error) {

        console.error(error);

        result.innerHTML =
            `❌ ${escapeHtml(
                error.message
            )}`;
    }
}


// ============================================================
// DASHBOARD
// ============================================================

function updateDashboard() {

    const totalStations =
        document.getElementById(
            "totalStations"
        );

    const totalDistricts =
        document.getElementById(
            "totalDistricts"
        );

    const totalPower =
        document.getElementById(
            "totalPower"
        );

    const totalConnectors =
        document.getElementById(
            "totalConnectors"
        );

    const districts =
        new Set();

    let totalPowerValue = 0;

    let totalConnectorValue = 0;

    allStations.forEach(
        function (station) {

            if (station.district) {

                districts.add(
                    station.district
                );
            }

            const power =
                Number(
                    station.charger_rating_kw
                );

            if (Number.isFinite(power)) {

                totalPowerValue += power;
            }

            const connectors =
                Number(
                    station.connector_count
                );

            if (
                Number.isFinite(
                    connectors
                )
            ) {

                totalConnectorValue +=
                    connectors;
            }
        }
    );

    if (totalStations) {

        totalStations.textContent =
            allStations.length;
    }

    if (totalDistricts) {

        totalDistricts.textContent =
            districts.size;
    }

    if (totalPower) {

        totalPower.textContent =
            `${formatNumber(
                totalPowerValue
            )} kW`;
    }

    if (totalConnectors) {

        totalConnectors.textContent =
            formatNumber(
                totalConnectorValue,
                0
            );
    }
}


// ============================================================
// ESTIMATED LOAD
// ============================================================

function calculateEstimatedLoad(
    chargerRating
) {

    const power =
        Number(chargerRating);

    if (
        !Number.isFinite(power) ||
        power < 0
    ) {

        return 0;
    }

    return (
        power *
        DEFAULT_UTILIZATION /
        100
    );
}


// ============================================================
// FORMAT NUMBER
// ============================================================

function formatNumber(
    value,
    decimals = 1
) {

    const number =
        Number(value);

    if (!Number.isFinite(number)) {

        return "0";
    }

    return number.toFixed(
        decimals
    );
}


// ============================================================
// FORMAT DISTANCE
// ============================================================

function formatRoadDistance(
    meters
) {

    const distance =
        Number(meters);

    if (
        !Number.isFinite(distance) ||
        distance < 0
    ) {

        return "Distance unavailable";
    }

    if (distance < 1000) {

        return `${Math.round(
            distance
        )} m`;
    }

    return `${(
        distance / 1000
    ).toFixed(1)} km`;
}


// ============================================================
// VALIDATE COORDINATES
// ============================================================

function isValidCoordinate(
    latitude,
    longitude
) {

    const lat =
        Number(latitude);

    const lon =
        Number(longitude);

    return (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -90 &&
        lat <= 90 &&
        lon >= -180 &&
        lon <= 180
    );
}


// ============================================================
// HTML ESCAPE
// ============================================================

function escapeHtml(value) {

    return String(
        value ?? ""
    )
    .replace(
        /&/g,
        "&amp;"
    )
    .replace(
        /</g,
        "&lt;"
    )
    .replace(
        />/g,
        "&gt;"
    )
    .replace(
        /"/g,
        "&quot;"
    )
    .replace(
        /'/g,
        "&#039;"
    );
}


// ============================================================
// LOADING
// ============================================================

function showStationLoading(show) {

    const loading =
        document.getElementById(
            "stationLoading"
        );

    if (!loading) {
        return;
    }

    loading.style.display =
        show
            ? "block"
            : "none";
}


// ============================================================
// ENTER KEY SEARCH
// ============================================================

function setupEnterKeySearch() {

    const input =
        document.getElementById(
            "locationInput"
        );

    if (!input) {
        return;
    }

    input.addEventListener(
        "keydown",
        function (event) {

            if (
                event.key === "Enter"
            ) {

                event.preventDefault();

                searchLocation();
            }
        }
    );
}



// ============================================================
// GLOBAL FUNCTIONS
// ============================================================

window.searchLocation =
    searchLocation;

window.findNearbyStations =
    findNearbyStations;

window.loadMoreStations =
    loadMoreStations;

window.applyFilters =
    applyFilters;

window.predictLoad =
    predictLoad;

window.focusStation =
    focusStation;

window.openDirections =
    openDirections;