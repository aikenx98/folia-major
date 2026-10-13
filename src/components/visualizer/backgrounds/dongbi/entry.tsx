import React from 'react';
import { DEFAULT_DONGBI_BACKGROUND_TUNING } from '../../../../types';
import DongbiBackground from './DongbiBackground';
import DongbiBackgroundSettingsCard from './DongbiBackgroundSettingsCard';
import { defineVisualizerBackground } from '../definition';

// src/components/visualizer/backgrounds/dongbi/entry.tsx
// Registers the user-supplied local video background ("动壁").

export default defineVisualizerBackground({
    mode: 'dongbi',
    order: 60,
    labelKey: 'options.visualizerBackgroundModeDongbi',
    labelFallback: '动壁',
    render: ({ config, paused, staticMode }) => (
        <DongbiBackground
            tuning={config?.dongbi?.tuning}
            paused={paused || staticMode}
        />
    ),
    renderSettingsPanel: ({ config, actions, t, isDaylight, theme, controlCardBg }) => (
        <DongbiBackgroundSettingsCard
            t={t}
            isDaylight={isDaylight}
            theme={theme}
            controlCardBg={controlCardBg}
            tuning={config?.dongbi?.tuning ?? DEFAULT_DONGBI_BACKGROUND_TUNING}
            onTuningChange={actions?.dongbi?.onTuningChange}
        />
    ),
    resetSettings: actions => actions?.dongbi?.onResetTuning?.(),
});
