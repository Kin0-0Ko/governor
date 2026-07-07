--[[
  enforce.lua — Atomic circuit-breaker enforcement script.

  KEYS:
    KEYS[1] = budget:{orgId:budgetId}:state          (FSM state string)
    KEYS[2] = budget:{orgId:budgetId}:spend           (cumulative micro-dollars as string)
    KEYS[3] = budget:{orgId:budgetId}:cap             (ceiling micro-dollars as string)
    KEYS[4] = budget:{orgId:budgetId}:ttl_exp         (OPEN→HALF_OPEN UNIX expiry timestamp)
    KEYS[5] = budget:{orgId:budgetId}:probe_inflight  (HALF_OPEN single-probe claim marker)

  ARGV:
    ARGV[1] = costMicros   (string, micro-dollars to debit)
    ARGV[2] = nowUnix      (string, current UNIX timestamp seconds)
    ARGV[3] = ttlSeconds   (string, HALF_OPEN probe window duration)

  Returns: table {allowed, state, spendMicros, remainingMicros}
    allowed = 1 (allow) or 0 (deny)
    state   = current FSM state string after evaluation

  Money-correctness invariant: a request that is DENIED (NO_BUDGET, OPEN,
  TRIPPED, or losing the HALF_OPEN probe race) NEVER debits spend. Only a
  request that is ALLOWED increments the spend counter.
--]]

local stateKey  = KEYS[1]
local spendKey  = KEYS[2]
local capKey    = KEYS[3]
local ttlKey    = KEYS[4]
local probeKey  = KEYS[5]

local costMicros  = tonumber(ARGV[1])
local nowUnix     = tonumber(ARGV[2])
local ttlSeconds  = tonumber(ARGV[3])

-- NO_BUDGET: cap key absent means no budget configured → hard deny, no debit
local capStr = redis.call('GET', capKey)
if not capStr then
  return {0, 'NO_BUDGET', '0', '0'}
end
local cap = tonumber(capStr)

-- Read current FSM state (default CLOSED if key absent)
local state = redis.call('GET', stateKey) or 'CLOSED'
local currentSpend = math.floor(tonumber(redis.call('GET', spendKey) or '0'))

-- OPEN state: check if TTL has expired for HALF_OPEN probe
if state == 'OPEN' then
  local expStr = redis.call('GET', ttlKey)
  local exp = expStr and tonumber(expStr) or 0
  if nowUnix < exp then
    -- Still within OPEN window: deny without debit
    local remaining = cap - currentSpend
    if remaining < 0 then remaining = 0 end
    return {0, 'OPEN', tostring(currentSpend), tostring(remaining)}
  end
  -- TTL expired: transition to HALF_OPEN for probe
  redis.call('SET', stateKey, 'HALF_OPEN')
  state = 'HALF_OPEN'
end

-- HALF_OPEN: only the request that claims the probe lock is treated as the
-- trial; all others are denied without debit while the probe is in flight.
if state == 'HALF_OPEN' then
  local claimed = redis.call('SET', probeKey, '1', 'NX', 'PX', tostring(ttlSeconds * 1000))
  if not claimed then
    local remaining = cap - currentSpend
    if remaining < 0 then remaining = 0 end
    return {0, 'OPEN', tostring(currentSpend), tostring(remaining)}
  end
end

-- Compute the would-be spend WITHOUT mutating any key yet.
local wouldBeSpend = currentSpend + costMicros

if wouldBeSpend >= cap then
  -- Breach: deny without debiting the denied request's cost.
  local newTtlExp = nowUnix + ttlSeconds
  redis.call('SET', stateKey, 'OPEN')
  redis.call('SET', ttlKey, tostring(newTtlExp))
  if state == 'HALF_OPEN' then
    redis.call('DEL', probeKey)
  end
  local remaining = cap - currentSpend
  if remaining < 0 then remaining = 0 end
  return {0, 'TRIPPED', tostring(currentSpend), tostring(remaining)}
end

-- Allowed: debit atomically now that the decision is made.
local newSpend = math.floor(redis.call('INCRBY', spendKey, costMicros))
local remaining = cap - newSpend
if remaining < 0 then remaining = 0 end

if state == 'HALF_OPEN' then
  redis.call('SET', stateKey, 'CLOSED')
  redis.call('DEL', probeKey)
end
-- If already CLOSED, no state write needed

return {1, 'ALLOWED', tostring(newSpend), tostring(remaining)}
