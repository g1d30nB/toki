// Agent-state layer on the robot: a port of simulator/src/state/agentState.ts
// plus expressionFor() from simulator/src/face/expressions.ts. Turns the Buddy
// stream into what Toki shows. In Phase 4 the bridge takes this role and the
// robot keeps this copy as a fallback for when the bridge is offline.
#pragma once

#include <stdint.h>

#include "face_data.h"

namespace toki {

enum class Activity : uint8_t { None, Think, Read, Search, Edit, Run, Test, Web, Subagent, Other };
enum class Mode : uint8_t { Idle, Working, Done, Error, Blocked };
enum class OneShotKind : uint8_t { Done, Error, Approved, Denied, ResolvedElsewhere, Subagents };
enum class Gesture : uint8_t { Tap, DoubleTap, LongPress };
/** What was under the finger: the face, or the right ("yes") or left ("no") button. */
enum class Target : uint8_t { Face, Yes, No };
/** Your answer to a permission prompt. Always allow goes by the bridge alone (step 5). */
enum class Answer : uint8_t { Allow, Deny, Always };

struct OneShot {
  OneShotKind kind;
  uint32_t at;
};

/** Tool call as far as the state layer cares: its id (hashed), what kind of work it is, and what on (for the label). */
struct ToolCall {
  uint32_t idHash;
  Activity kind;
  char object[40];  // a file's name, a command's first step, a site's host (labelObject in toki.ino)
};

class AgentState {
 public:
  // --- Events (each carries the robot's millis() as its time) ---
  void snapshot(uint32_t t, int total, int running, int waiting, const char* msg, long tokensToday, const char* promptId,
                const char* promptTool, const char* promptHint);
  void turn(uint32_t t, bool user, const ToolCall* tools, int toolCount, bool hasThinking, bool hasToolResult, bool toolError,
            const uint32_t* resultHashes, int resultCount);
  void decision(uint32_t t, const char* id, bool allow);
  /** The day rolled over (02:00 local, spec §3.4): reopen, and clear the day's count. */
  void newDay() {
    dayClosed_ = closeAsk_ = false;
    doneToday_ = 0;
  }
  /** A touch on the face (spec §6). What it means depends on the state. */
  void gesture(uint32_t t, Gesture g, Target target);

  /** Advances time: applies priority and hysteresis to what is shown. */
  void tick(uint32_t now);

  // --- Reading the state ---
  ExpressionId expression(uint32_t now) const;
  /** Night shutter target: 0 open, 1 after an earned close, 0.8 after a quiet one. */
  float shutter(uint32_t now) const;
  bool quiet(uint32_t now) const { return quiet_ && (int32_t)(quietUntil_ - now) > 0; }
  bool dayClosed() const { return dayClosed_; }
  bool earned() const { return earned_; }
  bool closeAsking(uint32_t now) const { return closeAsk_ && now - closeAskAt_ <= kStateConfig.closeAskMs; }
  // Two ways a prompt reaches Toki: Buddy (Bluetooth, desktop sessions) and a hook
  // held by the bridge (Wi-Fi, any session). Often both, for the same request: one
  // tap answers both, and Claude Code takes whichever lands first.
  bool blocked() const { return prompt_ || hookPrompt_; }
  bool buddyPrompt() const { return prompt_; }
  bool hookPrompt() const { return hookPrompt_; }
  const char* promptId() const { return promptId_; }
  const char* hookPromptId() const { return hookId_; }
  const char* promptTool() const { return prompt_ ? promptTool_ : hookTool_; }
  const char* promptHint() const { return prompt_ ? promptHint_ : hookHint_; }
  /** What "Always allow" would do, in words; empty when it isn't on offer (step 5). */
  const char* promptAlways() const { return hookPrompt_ ? hookAlways_ : ""; }
  /** From the bridge: a PermissionRequest hook is held, waiting for an answer. */
  void hookPromptOpened(uint32_t t, const char* id, const char* tool, const char* hint, const char* always,
                        const char* questionHeader = nullptr);
  /** Claude asked a question (AskUserQuestion): answered in Claude, never on Toki (step 6). */
  bool question() const;
  const char* questionHeader() const { return hookPrompt_ ? hookQuestion_ : ""; }
  /** From the bridge: that hook was answered or let go. */
  void hookPromptClosed(uint32_t t, const char* id);
  const uint32_t* subagents() const { return subagents_; }
  int subagentCount() const { return subagentCount_; }
  uint32_t turnMs(uint32_t now) const { return turnActive_ ? now - turnSince_ : 0; }
  Mode mode() const { return shownMode_; }
  Activity activity() const { return shownActivity_; }
  /**
   * What the latest tool works on, for the label under the face, but only when it
   * belongs to the face shown (the face lags the latest tool by its hysteresis).
   */
  const char* labelObject(ExpressionId face) const;

  static Activity classify(const char* name, const char* summary);

 private:
  void pushOneShot(OneShotKind kind, uint32_t at);
  bool latestOneShot(OneShotKind kind, uint32_t now, float windowMs) const;
  void target(uint32_t now, Mode& mode, Activity& activity) const;

  char msg_[96] = "";
  bool prompt_ = false;
  char promptId_[48] = "", promptTool_[24] = "", promptHint_[96] = "";
  bool hookPrompt_ = false;
  char hookId_[48] = "", hookTool_[24] = "", hookHint_[96] = "", hookAlways_[72] = "", hookQuestion_[16] = "";
  bool hookIsQuestion_ = false;
  // The Buddy prompt we last answered: the desktop keeps sending it for a moment
  // after an answer that went by the bridge alone (Always allow), so ignore it.
  char answeredId_[48] = "";
  uint32_t promptSince_ = 0;

  bool haveActivity_ = false;
  Activity activity_ = Activity::None;
  char object_[40] = "";
  uint32_t activityAt_ = 0;

  bool turnActive_ = false;
  uint32_t turnSince_ = 0;

  static constexpr int kMaxSubagents = 8;
  uint32_t subagents_[kMaxSubagents] = {};
  int subagentCount_ = 0;

  static constexpr int kMaxOneShots = 20;
  OneShot oneShots_[kMaxOneShots] = {};
  int oneShotCount_ = 0;

  // Touch states: the robot's own, not Claude's.
  bool boop_ = false, quiet_ = false, closeAsk_ = false, dayClosed_ = false, earned_ = false;
  uint32_t boopAt_ = 0, quietUntil_ = 0, closeAskAt_ = 0, closedAt_ = 0;
  int doneToday_ = 0;  // turns finished today (since boot; reopening keeps it): decides "earned"

  Mode shownMode_ = Mode::Idle;
  Activity shownActivity_ = Activity::None;
  uint32_t shownSince_ = 0;
};

/** FNV-1a: a stable 32-bit id for a tool_use id string. */
uint32_t hashId(const char* s);

}  // namespace toki
