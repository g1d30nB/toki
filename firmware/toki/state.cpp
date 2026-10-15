// Port of simulator/src/state/agentState.ts (+ expressionFor). Keep in step with it.
#include "state.h"

#include <ctype.h>
#include <string.h>

namespace toki {

namespace {

bool startsWith(const char* s, const char* p) { return strncmp(s, p, strlen(p)) == 0; }

bool containsNoCase(const char* s, const char* needle) {
  const size_t n = strlen(needle);
  for (; *s; s++) {
    size_t i = 0;
    while (i < n && s[i] && tolower((unsigned char)s[i]) == tolower((unsigned char)needle[i])) i++;
    if (i == n) return true;
  }
  return false;
}

void copy(char* dst, size_t size, const char* src) {
  strncpy(dst, src ? src : "", size - 1);
  dst[size - 1] = 0;
}

}  // namespace

uint32_t hashId(const char* s) {
  uint32_t h = 2166136261u;
  for (; s && *s; s++) h = (h ^ (uint8_t)*s) * 16777619u;
  return h;
}

Activity AgentState::classify(const char* n, const char* summary) {
  if (!strcmp(n, "Agent") || !strcmp(n, "Task")) return Activity::Subagent;
  if (!strcmp(n, "Edit") || !strcmp(n, "Write") || !strcmp(n, "MultiEdit") || !strcmp(n, "NotebookEdit")) return Activity::Edit;
  if (!strcmp(n, "Read") || !strcmp(n, "NotebookRead")) return Activity::Read;
  if (!strcmp(n, "Grep") || !strcmp(n, "Glob") || !strcmp(n, "ToolSearch")) return Activity::Search;
  if (!strcmp(n, "WebFetch") || !strcmp(n, "WebSearch") || containsNoCase(n, "browser") || containsNoCase(n, "chrome") ||
      containsNoCase(n, "navigate") || containsNoCase(n, "fetch"))
    return Activity::Web;
  if (!strcmp(n, "Bash")) {
    static const char* const kTests[] = {"npm test", "npm run test", "npx vitest", "npx jest", "npx playwright", "vitest", "jest",
                                         "pytest", "playwright test", "go test", "cargo test", "swift test", "xcodebuild test"};
    for (const char* t : kTests)
      if (strstr(summary, t)) return Activity::Test;
    return Activity::Run;
  }
  if (containsNoCase(n, "search") || containsNoCase(n, "find") || containsNoCase(n, "query")) return Activity::Search;
  if (containsNoCase(n, "read") || containsNoCase(n, "get_") || containsNoCase(n, "list_")) return Activity::Read;
  return Activity::Other;
}

void AgentState::pushOneShot(OneShotKind kind, uint32_t at) {
  if (oneShotCount_ == kMaxOneShots) {
    memmove(oneShots_, oneShots_ + 1, sizeof(OneShot) * (kMaxOneShots - 1));
    oneShotCount_--;
  }
  oneShots_[oneShotCount_++] = {kind, at};
}

bool AgentState::latestOneShot(OneShotKind kind, uint32_t now, float windowMs) const {
  for (int i = oneShotCount_ - 1; i >= 0; i--) {
    if (now - oneShots_[i].at > windowMs) return false;
    if (oneShots_[i].kind == kind) return true;
  }
  return false;
}

void AgentState::snapshot(uint32_t t, int, int, int waiting, const char* msg, long, const char* promptId, const char* promptTool,
                          const char* promptHint) {
  if (startsWith(msg, "done (") && !startsWith(msg_, "done (")) {
    const bool failed = containsNoCase(msg, "error") || containsNoCase(msg, "fail");
    pushOneShot(failed ? OneShotKind::Error : OneShotKind::Done, t);
    if (!failed) doneToday_++;
    turnActive_ = false;
    subagentCount_ = 0;  // a finished turn has no foreground subagents left
  }
  copy(msg_, sizeof msg_, msg);
  if (promptId && *promptId && waiting > 0 && strcmp(answeredId_, promptId) != 0) {
    if (!prompt_ || strcmp(promptId_, promptId) != 0) {
      prompt_ = true;
      copy(promptId_, sizeof promptId_, promptId);
      copy(promptTool_, sizeof promptTool_, promptTool);
      copy(promptHint_, sizeof promptHint_, promptHint);
      promptSince_ = t;
    }
  } else if (prompt_ && !(promptId && *promptId && waiting > 0)) {
    prompt_ = false;  // answered on the Mac
    if (hookPrompt_) return;  // the bridge still holds the same request; it clears it in a moment
    pushOneShot(OneShotKind::ResolvedElsewhere, t);
  }
}

void AgentState::turn(uint32_t t, bool user, const ToolCall* tools, int toolCount, bool hasThinking, bool hasToolResult,
                      bool toolError, const uint32_t* results, int resultCount) {
  if (toolError) pushOneShot(OneShotKind::Error, t);
  if (resultCount && subagentCount_) {
    int kept = 0;
    for (int i = 0; i < subagentCount_; i++) {
      bool done = false;
      for (int r = 0; r < resultCount; r++) done |= results[r] == subagents_[i];
      if (!done) subagents_[kept++] = subagents_[i];
    }
    subagentCount_ = kept;
  }
  if (user && !hasToolResult) {
    activity_ = Activity::Think;  // a new prompt: Claude starts thinking
    object_[0] = 0;
    activityAt_ = t;
    haveActivity_ = true;
    if (!turnActive_) {
      turnActive_ = true;
      turnSince_ = t;
    }
  }
  if (!user) {
    bool spawned = false;
    for (int i = 0; i < toolCount; i++) {
      if (tools[i].kind != Activity::Subagent) continue;
      spawned = true;
      if (subagentCount_ < kMaxSubagents) subagents_[subagentCount_++] = tools[i].idHash ? tools[i].idHash : t + i;
    }
    if (spawned) pushOneShot(OneShotKind::Subagents, t);
    if (toolCount) {
      activity_ = tools[toolCount - 1].kind;
      copy(object_, sizeof object_, tools[toolCount - 1].object);
      activityAt_ = t;
      haveActivity_ = true;
    } else if (hasThinking) {
      activity_ = Activity::Think;
      activityAt_ = t;
      haveActivity_ = true;
    } else if (haveActivity_) {
      activityAt_ = t;  // a text-only reply keeps the current activity alive
    }
  }
}

const char* AgentState::labelObject(ExpressionId face) const {
  if (!object_[0]) return "";
  static const ExpressionId kFace[] = {ExpressionId::Idle, ExpressionId::Think, ExpressionId::Read, ExpressionId::Search, ExpressionId::Edit,
                                       ExpressionId::Run,  ExpressionId::Test,  ExpressionId::Web,  ExpressionId::Subagent, ExpressionId::Working};
  const ExpressionId mine = kFace[(int)activity_];  // Activity order: None, Think, Read, …, Subagent, Other
  return face == mine || face == ExpressionId::Error ? object_ : "";
}

void AgentState::decision(uint32_t t, const char* id, bool allow) {
  // One tap answers both paths (toki.ino sends both answers, or only the hook's for Always allow).
  if (prompt_) copy(answeredId_, sizeof answeredId_, promptId_);
  prompt_ = false;
  hookPrompt_ = false;
  (void)id;
  pushOneShot(allow ? OneShotKind::Approved : OneShotKind::Denied, t);
}

bool AgentState::question() const {
  // By the bridge, or by Buddy alone (its prompt names the tool).
  return (hookPrompt_ && hookIsQuestion_) || (prompt_ && !strcmp(promptTool_, "AskUserQuestion"));
}

void AgentState::hookPromptOpened(uint32_t, const char* id, const char* tool, const char* hint, const char* always,
                                  const char* questionHeader) {
  hookIsQuestion_ = questionHeader != nullptr || !strcmp(tool, "AskUserQuestion");
  copy(hookQuestion_, sizeof hookQuestion_, questionHeader ? questionHeader : "");
  hookPrompt_ = true;
  copy(hookId_, sizeof hookId_, id);
  copy(hookTool_, sizeof hookTool_, tool);
  copy(hookHint_, sizeof hookHint_, hint);
  copy(hookAlways_, sizeof hookAlways_, always);
}

void AgentState::hookPromptClosed(uint32_t t, const char* id) {
  if (!hookPrompt_ || strcmp(hookId_, id) != 0) return;
  hookPrompt_ = false;
  if (!prompt_) pushOneShot(OneShotKind::ResolvedElsewhere, t);
}

void AgentState::gesture(uint32_t t, Gesture g, Target target) {
  // Blocked: only Allow / Deny count, and they arrive as decisions.
  if (blocked()) return;
  if (closeAsking(t)) {
    // "Close the day?": only its two buttons.
    if (g != Gesture::Tap || target == Target::Face) return;
    closeAsk_ = false;
    if (target == Target::Yes) {
      dayClosed_ = true;
      closedAt_ = t;
      earned_ = doneToday_ > 0;
      quiet_ = false;
    }
    return;
  }
  closeAsk_ = false;
  if (dayClosed_) {
    // A tap on the shutter reopens the day (Gideon, 3 Oct). The day's count
    // stays: only the 02:00 rollover (with the bridge's clock) resets it.
    if (g == Gesture::Tap) {
      dayClosed_ = false;
      boop_ = true;
      boopAt_ = t;
    }
    return;
  }
  if (g == Gesture::Tap) {
    // A tap wakes Toki: it ends quiet mode, and boops.
    quiet_ = false;
    boop_ = true;
    boopAt_ = t;
  } else if (g == Gesture::DoubleTap) {
    boop_ = false;  // the first tap of the two already booped; quiet takes over at once
    quiet_ = true;
    quietUntil_ = t + (uint32_t)kStateConfig.quietMs;
  } else {
    closeAsk_ = true;
    closeAskAt_ = t;
  }
}

float AgentState::shutter(uint32_t now) const {
  if (!dayClosed_ || shownMode_ == Mode::Blocked) return 0;
  if (now - closedAt_ < kStateConfig.closeShowMs) return 0;
  return earned_ ? 1 : 0.8f;
}

void AgentState::target(uint32_t now, Mode& mode, Activity& activity) const {
  const bool working = haveActivity_ && now - activityAt_ <= kStateConfig.activityHoldMs;
  const Activity w = working ? activity_ : Activity::None;
  if (blocked()) {
    mode = Mode::Blocked;
    activity = w;
  } else if (latestOneShot(OneShotKind::Error, now, kStateConfig.errorMs)) {
    mode = Mode::Error;
    activity = w;
  } else if (latestOneShot(OneShotKind::Done, now, kStateConfig.oneShotMs)) {
    mode = Mode::Done;
    activity = Activity::None;
  } else if (working) {
    mode = Mode::Working;
    activity = w;
  } else {
    mode = Mode::Idle;
    activity = Activity::None;
  }
}

void AgentState::tick(uint32_t now) {
  Mode want;
  Activity act;
  target(now, want, act);
  if (want == shownMode_ && act == shownActivity_) return;
  // Waking from idle, urgent states and one-shots switch at once; changes between
  // activities (and back to idle) wait out the dwell time.
  const bool immediate = shownMode_ == Mode::Idle || want == Mode::Blocked || shownMode_ == Mode::Blocked || want == Mode::Error ||
                         want == Mode::Done;
  if (!immediate && now - shownSince_ < kStateConfig.minDwellMs) return;
  shownMode_ = want;
  shownActivity_ = act;
  shownSince_ = now;
}

ExpressionId AgentState::expression(uint32_t now) const {
  // Blocked always surfaces: through quiet mode, and up through a closed shutter.
  if (shownMode_ == Mode::Blocked) return question() ? ExpressionId::Asked : ExpressionId::Blocked;
  if (closeAsking(now)) return ExpressionId::CloseAsk;
  if (dayClosed_) {
    if (now - closedAt_ < kStateConfig.closeShowMs) return earned_ ? ExpressionId::Closed : ExpressionId::Sleepy;
    return ExpressionId::Night;
  }
  if (boop_ && now - boopAt_ < kStateConfig.boopMs) return ExpressionId::Boop;
  // Your answer from the robot gets a brief reaction (spec §4.2).
  if (oneShotCount_) {
    const OneShot& last = oneShots_[oneShotCount_ - 1];
    if (now - last.at < 1200) {
      if (last.kind == OneShotKind::Approved) return ExpressionId::Approved;
      if (last.kind == OneShotKind::Denied) return ExpressionId::Denied;
    }
  }
  // Quiet mode hides everything but approvals (and your own boops).
  if (quiet(now)) return ExpressionId::Quiet;
  // Waiting on subagents: the subagent pose, even once Toki's own activity has gone quiet.
  if (subagentCount_ && (shownMode_ == Mode::Idle || (shownMode_ == Mode::Working && shownActivity_ == Activity::Subagent)))
    return ExpressionId::Subagent;
  switch (shownMode_) {
    case Mode::Done: return ExpressionId::Done;
    case Mode::Error: return ExpressionId::Error;
    case Mode::Idle: return ExpressionId::Idle;
    default: break;
  }
  switch (shownActivity_) {
    case Activity::Think: return ExpressionId::Think;
    case Activity::Read: return ExpressionId::Read;
    case Activity::Search: return ExpressionId::Search;
    case Activity::Edit: return ExpressionId::Edit;
    case Activity::Run: return ExpressionId::Run;
    case Activity::Test: return ExpressionId::Test;
    case Activity::Web: return ExpressionId::Web;
    case Activity::Subagent: return ExpressionId::Subagent;
    default: return ExpressionId::Working;
  }
}

}  // namespace toki
