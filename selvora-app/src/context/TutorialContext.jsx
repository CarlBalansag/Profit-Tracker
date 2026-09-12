import React, { useState, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';

import { TutorialContext, TUTORIAL_STEPS } from './tutorial';

export const TutorialProvider = ({ children }) => {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const start = useCallback(() => {
    setStepIndex(0);
    setActive(true);
  }, []);

  const next = useCallback(() => {
    setStepIndex(i => {
      if (i >= TUTORIAL_STEPS.length - 1) return i;
      return i + 1;
    });
  }, []);

  const back = useCallback(() => {
    setStepIndex(i => Math.max(0, i - 1));
  }, []);

  const finish = useCallback(async () => {
    setActive(false);
    setStepIndex(0);
    try {
      await apiFetch('/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorial_seen: true }),
      });
    } catch {
      // non-critical — tutorial just won't be marked seen on server
    }
  }, []);

  const skip = finish;

  const currentStep = TUTORIAL_STEPS[stepIndex];

  return (
    <TutorialContext.Provider value={{ active, start, next, back, finish, skip, stepIndex, currentStep, totalSteps: TUTORIAL_STEPS.length }}>
      {children}
    </TutorialContext.Provider>
  );
};
