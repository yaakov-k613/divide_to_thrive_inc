let player = null;
let ytApiReady = false;

// Called by the YouTube IFrame API when it's ready
window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  player = new YT.Player("player", {
    width: "100%",
    height: "360"
  });
};

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("video-form");
  const statusEl = document.getElementById("status-message");
  const segmentsBody = document.getElementById("segments-body");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearStatus();
    clearSegments(segmentsBody);

    const urlInput = document.getElementById("video-url");
    const durationInput = document.getElementById("segment-duration");
    const format = document.querySelector(
      "input[name='time-format']:checked"
    ).value;

    const videoUrl = urlInput.value.trim();
    const segmentStr = durationInput.value.trim();

    if (!ytApiReady || !player) {
      setStatus(
        "YouTube Player API is still loading. Please wait a moment and try again.",
        true
      );
      return;
    }

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      setStatus("Please enter a valid YouTube video URL.", true);
      return;
    }

    let segmentDurationSeconds;
    try {
      segmentDurationSeconds = parseHmsToSeconds(segmentStr);
    } catch (err) {
      setStatus(err.message || "Invalid segment duration.", true);
      return;
    }

    if (segmentDurationSeconds <= 0) {
      setStatus("Segment duration must be greater than 0 seconds.", true);
      return;
    }

    setStatus("Loading video and calculating duration…");

    player.cueVideoById(videoId);

    const maxWaitMs = 10000;
    const intervalMs = 400;
    let waited = 0;

    const timer = setInterval(() => {
      const duration = player.getDuration();
      if (duration && duration > 0) {
        clearInterval(timer);
        buildSegments({
          totalDuration: duration,
          baseUrl: videoUrl,
          segmentDurationSeconds,
          format,
          tbody: segmentsBody
        });
        setStatus(
          `Generated segments for video (${formatSeconds(duration)} total).`
        );
      } else {
        waited += intervalMs;
        if (waited >= maxWaitMs) {
          clearInterval(timer);
          setStatus(
            "Unable to read video duration. The video may be restricted or unavailable.",
            true
          );
        }
      }
    }, intervalMs);
  });

  // Click handler: play segment inside the embedded player
  segmentsBody.addEventListener("click", (e) => {
    const link = e.target.closest(".segment-link");
    if (!link) return;

    e.preventDefault();
    const start = Number(link.dataset.start);

    if (!ytApiReady || !player) {
      setStatus("Player is not ready yet.", true);
      return;
    }

    player.seekTo(start, true);
    player.playVideo();
  });

  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle("status-message--error", !!isError);
  }

  function clearStatus() {
    setStatus("");
  }
});

function clearSegments(tbody) {
  tbody.innerHTML =
    '<tr><td colspan="4" class="segments-empty">No segments yet. Enter a video URL and duration, then click “Generate Segments”.</td></tr>';
}

function extractVideoId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      return u.pathname.slice(1) || null;
    }

    if (host === "youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return v;

      const parts = u.pathname.split("/").filter(Boolean);
      const shortsIndex = parts.indexOf("shorts");
      if (shortsIndex !== -1 && parts[shortsIndex + 1]) {
        return parts[shortsIndex + 1];
      }

      const embedIndex = parts.indexOf("embed");
      if (embedIndex !== -1 && parts[embedIndex + 1]) {
        return parts[embedIndex + 1];
      }
    }

    return null;
  } catch {
    return null;
  }
}

function parseHmsToSeconds(str) {
  if (!str) throw new Error("Segment duration is required.");

  const cleaned = str.trim();
  const parts = cleaned.split(":").map((p) => p.trim());

  if (parts.some((p) => p === "" || isNaN(Number(p)))) {
    throw new Error("Use HH:MM:SS, MM:SS, or SS (numbers only).");
  }

  let seconds = 0;
  if (parts.length === 3) {
    const [h, m, s] = parts.map(Number);
    seconds = h * 3600 + m * 60 + s;
  } else if (parts.length === 2) {
    const [m, s] = parts.map(Number);
    seconds = m * 60 + s;
  } else if (parts.length === 1) {
    seconds = Number(parts[0]);
  } else {
    throw new Error("Invalid duration format.");
  }

  if (!isFinite(seconds) || seconds <= 0) {
    throw new Error("Segment duration must be greater than 0 seconds.");
  }

  return seconds;
}

function formatSeconds(secondsTotal) {
  const s = Math.floor(secondsTotal % 60);
  const m = Math.floor((secondsTotal / 60) % 60);
  const h = Math.floor(secondsTotal / 3600);

  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");

  return `${hh}:${mm}:${ss}`;
}

function toHmsParam(secondsTotal) {
  const s = Math.floor(secondsTotal % 60);
  const m = Math.floor((secondsTotal / 60) % 60);
  const h = Math.floor(secondsTotal / 3600);
  return `${h}h${m}m${s}s`;
}

function buildSegments({
  totalDuration,
  baseUrl,
  segmentDurationSeconds,
  format,
  tbody
}) {
  const rows = [];
  let index = 1;

  for (let start = 0; start < totalDuration; start += segmentDurationSeconds) {
    const end = Math.min(start + segmentDurationSeconds, totalDuration);

    const startLabel = formatSeconds(start);
    const endLabel = formatSeconds(end);

    const segmentUrl = buildSegmentUrl(baseUrl, start, format);

    rows.push(
      `<tr>
        <td>${index}</td>
        <td>${startLabel}</td>
        <td>${endLabel}</td>
        <td>
          <a class="segment-link"
             href="${segmentUrl}"
             data-start="${Math.floor(start)}">
             Play segment
          </a>
        </td>
      </tr>`
    );

    index += 1;
  }

  tbody.innerHTML = rows.join("");
}

function buildSegmentUrl(base, startSeconds, format) {
  let url;
  try {
    url = new URL(base);
  } catch {
    return base;
  }

  url.searchParams.delete("t");

  if (format === "hms") {
    url.searchParams.set("t", toHmsParam(startSeconds));
  } else {
    url.searchParams.set("t", String(Math.floor(startSeconds)));
  }

  return url.toString();
}
