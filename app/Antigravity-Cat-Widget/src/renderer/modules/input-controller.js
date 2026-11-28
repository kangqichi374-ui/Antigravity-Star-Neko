(() => {
  function createInputController({
    api,
    $,
    mascot,
    motion,
    rig,
    gestures,
    bubbleAudio,
    getSnapshot
  }) {
    let pointer = null;
    let partPointer = null;
    let hit = null;
    let pressSeq = 0;
    let pressStartAt = 0;
    let pressReleaseTimer = null;
    let lastPointerPos = null;
    let dragMoveRaf = 0;
    let pendingDragPoint = null;

    const sideHeld = { 3: null, 4: null };
    const lastSideEventAt = { 3: 0, 4: 0 };
    const partReleaseTimers = { earL: null, earR: null, ahoge: null };
    const partSeqs = { earL: 0, earR: 0, ahoge: 0 };

    const hasSideButtonHeld = () => Boolean(sideHeld[3] || sideHeld[4]);
    const isPartHeld = part =>
      partPointer?.part === part || sideHeld[3]?.part === part || sideHeld[4]?.part === part;
    const hasPartReleaseTimer = part => Boolean(partReleaseTimers[part]);
    const isPointerActive = () => Boolean(pointer);
    const isEarBusy = () =>
      Boolean(
        pointer ||
          isPartHeld("earL") ||
          isPartHeld("earR") ||
          partReleaseTimers.earL ||
          partReleaseTimers.earR
      );

    function clearPartReleaseTimers() {
      for (const k of ["earL", "earR", "ahoge"]) {
        clearTimeout(partReleaseTimers[k]);
        partReleaseTimers[k] = null;
        partSeqs[k]++;
      }
    }

    function recordPointerPos(e) {
      if (e && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
        lastPointerPos = { x: e.clientX, y: e.clientY };
      }
    }

    function isPointInteractive(e) {
      recordPointerPos(e);
      if (document.querySelector(".interactive:hover")) return true;
      if (lastPointerPos) {
        const el = document.elementFromPoint(lastPointerPos.x, lastPointerPos.y);
        if (el && el.closest(".interactive")) return true;
      }
      return false;
    }

    function syncHitAfterRelease(e = null) {
      if (partPointer || hasSideButtonHeld() || pointer) return;
      const stillInteractive = isPointInteractive(e);
      if (hit !== stillInteractive) {
        hit = stillInteractive;
        api.hit(stillInteractive);
      }
    }

    function sideButtonTargetEar(btn) {
      const flipped = mascot.dataset.facing === "left";
      if (btn === 4) return flipped ? "earR" : "earL"; // 前侧键 -> 视觉左耳
      if (btn === 3) return flipped ? "earL" : "earR"; // 后侧键 -> 视觉右耳
      return null;
    }

    function schedulePartRelease(part, seq, startAt, cancel) {
      clearTimeout(partReleaseTimers[part]);
      partReleaseTimers[part] = null;
      if (isPartHeld(part) || pointer) return;
      const dwell = cancel ? 0 : Math.max(0, 110 - (performance.now() - startAt));
      if (dwell <= 0) {
        rig.pressPart(part, false);
      } else {
        partReleaseTimers[part] = setTimeout(() => {
          partReleaseTimers[part] = null;
          if (partSeqs[part] === seq && !isPartHeld(part) && !pointer) {
            rig.pressPart(part, false);
          }
        }, dwell);
      }
    }

    function pressSideButton(btn) {
      const part = sideButtonTargetEar(btn);
      if (!part || sideHeld[btn]) return;
      lastSideEventAt[btn] = performance.now();
      clearTimeout(partReleaseTimers[part]);
      partReleaseTimers[part] = null;
      partSeqs[part]++;
      sideHeld[btn] = { part, seq: partSeqs[part], startAt: performance.now() };
      if (hit !== true) {
        hit = true;
        api.hit(true);
      }
      rig.pressPart(part, true);
      bubbleAudio.play("press");
    }

    function releaseSideButton(btn, cancel = false, ev = null) {
      const held = sideHeld[btn];
      if (!held) return;
      lastSideEventAt[btn] = performance.now();
      sideHeld[btn] = null;
      schedulePartRelease(held.part, held.seq, held.startAt, cancel);
      bubbleAudio.play("release");
      syncHitAfterRelease(ev);
    }

    function releaseAllSideButtons(cancel = true, ev = null) {
      if (sideHeld[3]) releaseSideButton(3, cancel, ev);
      if (sideHeld[4]) releaseSideButton(4, cancel, ev);
    }

    function syncSideButtonsMask(buttons, allowPress = false, ev = null) {
      if (typeof buttons !== "number") return;
      const down3 = (buttons & 8) !== 0;
      const down4 = (buttons & 16) !== 0;
      if (allowPress) {
        if (down3 && !sideHeld[3]) pressSideButton(3);
        if (down4 && !sideHeld[4]) pressSideButton(4);
      }
      if (sideHeld[3] && !down3) releaseSideButton(3, false, ev);
      if (sideHeld[4] && !down4) releaseSideButton(4, false, ev);
    }

    function releasePart(cancel = false, ev = null) {
      if (!partPointer) return;
      const { part, seq, startAt } = partPointer;
      partPointer = null;
      delete motion.dataset.partPressed;
      schedulePartRelease(part, seq, startAt, cancel);
      bubbleAudio.play("release");
      syncHitAfterRelease(ev);
    }

    function flushDragMove() {
      if (dragMoveRaf) {
        cancelAnimationFrame(dragMoveRaf);
        dragMoveRaf = 0;
      }
      if (pendingDragPoint && pointer) {
        const pt = pendingDragPoint;
        pendingDragPoint = null;
        if (typeof api.dragMove === "function") api.dragMove(pt);
        else api.pointer({ action: "move", point: pt });
      } else {
        pendingDragPoint = null;
      }
    }

    async function releaseBody(cancel = false) {
      if (!pointer) return;
      flushDragMove();
      const seq = pointer.seq;
      const wasMoved = pointer.moved;
      pointer = null;
      clearTimeout(pressReleaseTimer);
      const dwell = cancel || wasMoved ? 0 : Math.max(0, 110 - (performance.now() - pressStartAt));
      if (dwell <= 0) {
        gestures.invalidateFaceRect();
        rig.animateBodyPress(false, { isPartHeld, clearPartReleaseTimers });
      } else {
        pressReleaseTimer = setTimeout(() => {
          if (seq === pressSeq && !pointer) {
            gestures.invalidateFaceRect();
            rig.animateBodyPress(false, { isPartHeld, clearPartReleaseTimers });
          }
        }, dwell);
      }
      bubbleAudio.play("release");
      const result = await api.pointer(cancel ? "cancel" : "up");
      if (seq !== pressSeq) return;
      if (!result?.moved && !wasMoved && !cancel) {
        bubbleAudio.clickCharacter();
        bubbleAudio.reaction(false, true);
      }
    }

    function bindEvents() {
      $("settings").onclick = () => api.command("settings");

      window.addEventListener("contextmenu", e => {
        e.preventDefault();
        api.command("menu");
      });

      window.addEventListener(
        "wheel",
        e => {
          const snapshot = getSnapshot();
          if (!snapshot) return;
          const mode = snapshot.settings.wheelAction || "page";
          if (mode === "none") return;
          e.preventDefault();
          if (mode === "page") {
            if (bubbleAudio.isClosed()) bubbleAudio.clickCharacter();
            else bubbleAudio.clickBubble();
          } else if (mode === "scale") {
            const cur = snapshot.settings.scale || 220;
            const next = Math.max(140, Math.min(360, cur + (e.deltaY < 0 ? 10 : -10)));
            if (next !== cur) api.save({ scale: next });
          }
        },
        { passive: false }
      );

      // 鼠标侧键控制双耳（零全局系统钩子）
      mascot.addEventListener("pointerdown", e => {
        recordPointerPos(e);
        const isSide = e.button === 3 || e.button === 4 || (e.buttons & 24) !== 0;
        if (!isSide) return;
        const hitTarget = e.target.closest(".interactive");
        if (!hasSideButtonHeld() && !hitTarget) return;
        if (!pointer && !partPointer) {
          try {
            (hitTarget || motion).setPointerCapture(e.pointerId);
          } catch {}
        }
        if (e.button === 3 || e.button === 4) pressSideButton(e.button);
        syncSideButtonsMask(e.buttons, true, e);
      });
      mascot.addEventListener("pointermove", e => {
        recordPointerPos(e);
        if (hasSideButtonHeld() || (e.buttons & 24) !== 0) {
          syncSideButtonsMask(
            e.buttons,
            hasSideButtonHeld() || Boolean(e.target.closest(".interactive")),
            e
          );
        }
      });
      mascot.addEventListener("pointerup", e => {
        recordPointerPos(e);
        if (hasSideButtonHeld()) syncSideButtonsMask(e.buttons, false, e);
      });
      mascot.addEventListener("pointercancel", e => releaseAllSideButtons(true, e));
      mascot.addEventListener("lostpointercapture", e => releaseAllSideButtons(true, e));

      window.addEventListener("mousedown", e => {
        recordPointerPos(e);
        if (e.button !== 3 && e.button !== 4) return;
        if (!hasSideButtonHeld() && !e.target.closest(".interactive")) return;
        e.preventDefault();
        pressSideButton(e.button);
      });
      window.addEventListener("mouseup", e => {
        recordPointerPos(e);
        if (e.button !== 3 && e.button !== 4) return;
        if (sideHeld[e.button] || isPointInteractive(e)) {
          e.preventDefault();
        }
        if (!sideHeld[e.button]) return;
        releaseSideButton(e.button, false, e);
      });
      window.addEventListener("auxclick", e => {
        if (e.button === 3 || e.button === 4) {
          e.preventDefault();
        }
      });

      if (typeof api.onSideButton === "function") {
        api.onSideButton(ev => {
          const btn = ev?.button;
          if (btn !== 3 && btn !== 4) return;
          if (ev.tap) {
            if (!sideHeld[btn] && performance.now() - lastSideEventAt[btn] > 300) {
              pressSideButton(btn);
              releaseSideButton(btn, false);
            }
            return;
          }
          if (ev.pressed) pressSideButton(btn);
          else releaseSideButton(btn, false);
        });
      }

      // 角色本体与耳/呆毛部位交互
      motion.addEventListener("pointerdown", e => {
        gestures.resetHairRub();
        if (e.button !== 0) return;
        const hitPart = gestures.hitTestPart(e.clientX, e.clientY);
        if (hitPart !== "body") {
          if (partPointer) releasePart(true);
          clearTimeout(partReleaseTimers[hitPart]);
          partReleaseTimers[hitPart] = null;
          partSeqs[hitPart]++;
          partPointer = {
            id: e.pointerId,
            part: hitPart,
            seq: partSeqs[hitPart],
            startAt: performance.now()
          };
          motion.dataset.partPressed = hitPart;
          motion.setPointerCapture(e.pointerId);
          rig.pressPart(hitPart, true);
          bubbleAudio.play("press");
          return;
        }
        clearTimeout(pressReleaseTimer);
        pressSeq++;
        pressStartAt = performance.now();
        pointer = { id: e.pointerId, x: e.screenX, y: e.screenY, moved: false, seq: pressSeq };
        motion.setPointerCapture(e.pointerId);
        gestures.invalidateFaceRect();
        rig.animateBodyPress(true, { isPartHeld, clearPartReleaseTimers });
        api.pointer({ action: "down", point: { x: e.screenX, y: e.screenY } });
        bubbleAudio.play("press");
      });

      motion.addEventListener("pointermove", e => {
        if (partPointer) {
          gestures.resetHairRub();
          return;
        }
        if (pointer) {
          gestures.resetHairRub();
          if (Math.hypot(e.screenX - pointer.x, e.screenY - pointer.y) > 8) pointer.moved = true;
          pendingDragPoint = { x: e.screenX, y: e.screenY };
          if (!dragMoveRaf) {
            dragMoveRaf = requestAnimationFrame(() => {
              dragMoveRaf = 0;
              if (pendingDragPoint && pointer) {
                const pt = pendingDragPoint;
                pendingDragPoint = null;
                if (typeof api.dragMove === "function") api.dragMove(pt);
                else api.pointer({ action: "move", point: pt });
              }
            });
          }
          return;
        }
        if (hasSideButtonHeld()) {
          gestures.resetHairRub();
          return;
        }
        const hoverPart = gestures.hitTestPart(e.clientX, e.clientY);
        if (hoverPart !== "body") {
          if (motion.dataset.hoverPart !== hoverPart) motion.dataset.hoverPart = hoverPart;
        } else if (motion.dataset.hoverPart) {
          delete motion.dataset.hoverPart;
        }

        if (gestures.trackHairRub(e, performance.now())) {
          api.pointer("pet");
        }
      });

      motion.addEventListener("pointerleave", () => {
        delete motion.dataset.hoverPart;
        gestures.resetHairRub();
      });

      motion.addEventListener("pointerup", e => {
        releasePart(false, e);
        releaseBody();
      });
      motion.addEventListener("pointercancel", e => {
        releasePart(true, e);
        releaseBody(true);
      });
      motion.addEventListener("lostpointercapture", e => {
        releasePart(true, e);
        releaseBody(true);
      });
      window.addEventListener("blur", () => {
        gestures.resetHairRub();
        lastPointerPos = null;
        releaseAllSideButtons(true);
        releasePart(true);
        releaseBody(true);
      });

      motion.addEventListener("keydown", e => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          bubbleAudio.clickCharacter();
          bubbleAudio.reaction(false, true);
        }
      });

      window.addEventListener("mousemove", e => {
        recordPointerPos(e);
        if (hasSideButtonHeld()) syncSideButtonsMask(e.buttons, false, e);
        const active = Boolean(partPointer) || hasSideButtonHeld() || !!e.target.closest(".interactive");
        if (hit !== active) {
          hit = active;
          api.hit(active);
        }
      });

      window.addEventListener("mouseleave", () => {
        lastPointerPos = null;
        if (partPointer || hasSideButtonHeld()) return;
        hit = false;
        api.hit(false);
      });
    }

    function destroy() {
      clearTimeout(pressReleaseTimer);
      clearPartReleaseTimers();
      cancelAnimationFrame(dragMoveRaf);
    }

    return {
      isPointerActive,
      isEarBusy,
      isPartHeld,
      hasPartReleaseTimer,
      clearPartReleaseTimers,
      bindEvents,
      destroy
    };
  }

  window.StarNeko = window.StarNeko || {};
  window.StarNeko.createInputController = createInputController;
})();
