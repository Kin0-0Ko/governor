--[[
  enforce.lua — Atomic circuit-breaker enforcement script.

  KEYS:
    KEYS[1] = budget:{orgId:budgetId}:state    (FSM state string)
    KEYS[2] = budget:{orgId:budgetId}:spend    (cumulative micro-dollars as string)
    KEYS[3] = budget:{orgId:budgetId}:cap      (ceiling micro-dollars as string)
    KEYS[4] = budget:{orgId:budgetId}:ttl_exp  (OPEN→HALF_OPEN UNIX expiry timestamp)

  ARGV:
    ARGV[1] = costMicros   (string, micro-dollars to debit)
    ARGV[2] = nowUnix      (string, current UNIX timestamp seconds)
    ARGV[3] = ttlSeconds   (string, HALF_OPEN probe window duration)

  Returns: table {allowed, state, spendMicros, remainingMicros}
    allowed = 1 (allow) or 0 (deny)
    state   = current FSM state string after evaluation
--]]

local stateKey  = KEYS[1]
local spendKey  = KEYS[2]
local capKey    = KEYS[3]
local ttlKey    = KEYS[4]

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

-- OPEN state: check if TTL has expired for HALF_OPEN probe
if state == 'OPEN' then
  local expStr = redis.call('GET', ttlKey)
  local exp = expStr and tonumber(expStr) or 0
  if nowUnix < exp then
    -- Still within OPEN window: deny without debit
    local currentSpend = math.floor(tonumber(redis.call('GET', spendKey) or '0'))
    local remaining = cap - currentSpend
    if remaining < 0 then remaining = 0 end
    return {0, 'OPEN', tostring(currentSpend), tostring(remaining)}
  end
  -- TTL expired: transition to HALF_OPEN for probe
  redis.call('SET', stateKey, 'HALF_OPEN')
  state = 'HALF_OPEN'
end

-- HALF_OPEN: allow exactly one probe request through; re-evaluate after debit
-- (probe is allowed to proceed; result of debit determines next transition)

-- Debit: atomic increment (floor ensures integer string in all Redis impls)
local newSpend = math.floor(redis.call('INCRBY', spendKey, costMicros))
local remaining = cap - newSpend
if remaining < 0 then remaining = 0 end

-- Check if cap is breached
if newSpend >= cap then
  -- Trip or remain OPEN
  local newTtlExp = nowUnix + ttlSeconds
  redis.call('SET', stateKey, 'OPEN')
  redis.call('SET', ttlKey, tostring(newTtlExp))
  return {0, 'TRIPPED', tostring(newSpend), '0'}
end

-- Cap not breached: allow and ensure CLOSED state
if state == 'HALF_OPEN' then
  redis.call('SET', stateKey, 'CLOSED')
end
-- If already CLOSED, no state write needed

return {1, 'ALLOWED', tostring(newSpend), tostring(remaining)}
