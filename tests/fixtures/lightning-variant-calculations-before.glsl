    float strokeBrightnessMult = isHyperbolt ? hyperboltBrightnessMult : superboltBrightnessMult;
    float strokeDurationShorten = isHyperbolt ? hyperboltDurationShorten : superboltDurationShorten;
    // These intrinsic temperatures feed the channel; the apparent variant tint
    // below also accounts for unresolved cores and atmospheric filtering.
    vec3 positiveLightningCol = planckBlackbody(14000.0 + 4000.0 * (random2d(vec2(lightningPos.y * 4.7, lightningMeta.x * 9.1)) - 0.5));
    float repeatPeriod = map_range(random2d(lightningPos), 0., 1., 1.5, 3.0);
    if (isSuperbolt && lightningTime >= repeatPeriod * lightningFlickers(lightningData) + (2.924 - strokeDurationShorten))
      continue;
    float effectiveLightningTime = isSuperbolt && lightningTime > 0.0
      ? lightningTime + strokeDurationShorten * smoothstep(0.0, 0.35, lightningTime)
      : lightningTime;
    if (isSuperbolt) {
      currentLightningIntensity = lightningIntensityOverTime(effectiveLightningTime, lightningPos, lightningData[INTENSITY]);
      if (currentLightningIntensity <= 0.0)
        continue;
    }
    float tailT = max(effectiveLightningTime - repeatPeriod * lightningFlickers(lightningData), 0.0);
    float extTailFade = pow(smoothstep(2.924, 1.15, tailT), 2.4);
    float ccTailFade = pow(smoothstep(2.924, 1.25, tailT), 2.2);
    float ccIntensityGain = (isPositiveCC ? 1.5 : 1.0) * (1.8 / max(pow(lightningData[INTENSITY], 2.0), 0.1));
    float extBaseIntensity = clamp(mix(1.8, 3.4, (lightningData[INTENSITY] - 4.6) / 0.8), 1.8, 3.4);
    float extIntensityGain = pow(extBaseIntensity / max(lightningData[INTENSITY], 1.0), 2.0);
    float extCurve = currentLightningIntensity * extIntensityGain * extTailFade;
    // Hyperbolts compress the geometry and tail clock to fit a 0.3-unit
    // lifetime. Keep the initial return bright on the real clock instead of
    // letting that accelerated tail extinguish it before attachment.
    if (isHyperbolt)
      extCurve = max(extCurve, firstReturnIntensity(lightningTime, lightningData[INTENSITY], 0.10, 0.26) * extIntensityGain);
