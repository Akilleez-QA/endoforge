export const recorded = {
  type: 'rate_limit_event',
  rate_limit_info: { status: 'allowed', resetsAt: 1794607200, rateLimitType: 'seven_day', overageStatus: 'rejected', overageDisabledReason: 'out_of_credits', isUsingOverage: false,
    unifiedWindows: { seven_day: { utilization: 0.1, resetsAt: 1794607200, status: 'allowed' } } },
  uuid: '00000000-0000-0000-0000-000000000000', session_id: '00000000-0000-0000-0000-000000000000',
};

export const windowEvent = ({ utilization, status = 'allowed', resetsAt = 1794607200, window = 'seven_day', overage = {} }) => ({
  type: 'rate_limit_event',
  rate_limit_info: { status, resetsAt, rateLimitType: window, overageStatus: 'rejected', overageDisabledReason: 'out_of_credits', isUsingOverage: false, ...overage,
    unifiedWindows: { [window]: { utilization, resetsAt, status } } },
  uuid: '00000000-0000-0000-0000-000000000000', session_id: '00000000-0000-0000-0000-000000000000',
});
