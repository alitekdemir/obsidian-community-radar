const core = {
  // i18n, formatting & settings
  setLanguage, matchLanguage, t, tIn, LOCALE_NAMES, STRINGS, defaultSettings,
  dayString, dayStart, formatCount, formatCost, formatShort, relativeDays, formatTime, safeFileName,
  // catalog, timeline & discovery
  parseCatalog, newTimeline, mergeTimeline, seriesDays, gainOver, reachedAt, passedAt, milestoneSteps,
  lastHatch, updateWaves, releaseWaves, releaseGaps, releaseCadence, cadenceLabel, cadenceSub, cadenceNote, spanLabel,
  isNewPlugin, isUnreviewed, isSnoozed, catalogDelta, removedRows,
  modeOptions, tableColumns, addableFilters, clearedFilters, changedFilters, filterSummary,
  discover, matchCount, matchRows, sortRows, modeCounts, groupSections, groupHue, statusKey,
  UNGROUPED, UPDATES, TOP_RATED,
  // home widgets
  HOME_WIDGETS, widgetResult, widgetRows, sinceParams, recordVisit, within,
  legacyViewQuery, normalizeHome, unplacedWidgets, sinceMoment,
  // query language
  QUERY_FIELDS, QUERY_FUNCS, QUERY_PRESETS, GALLERY_SECTIONS,
  compileQuery, parseQuery, tokenize, isAdvancedQuery, querySuggestions, queryHighlight, queryTip,
  filtersToQuery, queryToFilters, queryToBasic, queryStarters, queryDiff, queryChanges, sameQuery,
  defaultPageQuery, pageQuery, joinQuery, withOrder, splitQuery, splitOrder, dropClause, narrowQuery,
  migrateQuery, migrateFields011, libraryQuery, migrateLibraryField, migrateLibraryNames,
  // markdown, README & notes
  escapeOutsideCode, absolutizeLinks, readmeBody, readmeSection, readmeVersion, readmeMeta, readmeText,
  textHash, translationSection, replaceReadme, readmeTranslation, replaceReadmeTranslation, skipDevSections,
  noteBody, stripDescription, migrateHeadings, migrateStatuses, migrateImages,
  baseFile, sourceFields, noteFromFrontmatter, groupsOf, uniqueNames,
  // AI, translation, profiles & similar
  PROVIDERS, KEY_NAMES, sumUsage, tokenPrice, formatPrice, filterModels, aiEstimate, errorDetail,
  translationPrompt, parseTranslations, groupPrompt, parseGroupSuggestions,
  foreignShare, scriptOfLanguage, translationProblem, englishLink, englishSection,
  parseSimilar, similarIds, closeness, closenessShare, sharedFacets, closestGroup,
  mapLimit,
  constants: {
    DAY_MS, HATCHED_DAYS, README_START, README_END, README_TR_START,
  },
};
