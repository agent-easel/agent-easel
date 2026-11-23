/** Search words a Run search accepts, as Chat control's Find Runs and `factory_list_runs` share them. */
export const RUN_SEARCH_MAX_WORDS = 8;

export const searchWords = (text: string) => text.trim().split(/\s+/);
