export const streamTailMs = ({ lastToken, resultAt, finalFinishedAt }) => Math.max(lastToken, resultAt ?? lastToken, finalFinishedAt ?? lastToken) - lastToken;
