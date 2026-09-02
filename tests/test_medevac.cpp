#include "framework/configfile.h"
#include "framework/logger.h"
#include "game/state/city/medevac.h"

#include <vector>

using namespace OpenApoc;

static void fail(const char *message)
{
	LogError("{0}", message);
	exit(EXIT_FAILURE);
}

static void expect(bool condition, const char *message)
{
	if (!condition)
	{
		fail(message);
	}
}

static MedevacPlanner::BaseCandidate base(int distanceSquared, bool isHomeBase,
                                          int freeMedicalCapacity)
{
	MedevacPlanner::BaseCandidate candidate;
	candidate.distanceSquared = distanceSquared;
	candidate.isHomeBase = isHomeBase;
	candidate.freeMedicalCapacity = freeMedicalCapacity;
	return candidate;
}

static MedevacPlanner::AgentCandidate agent(bool woundedXComSoldier)
{
	MedevacPlanner::AgentCandidate candidate;
	candidate.woundedXComSoldier = woundedXComSoldier;
	return candidate;
}

// No base with free capacity => no destination.
static void test_no_capacity_base()
{
	const std::vector<MedevacPlanner::BaseCandidate> bases = {
	    base(10, false, 0), base(5, true, -2)};
	const auto plan = MedevacPlanner::plan(bases, 4, {agent(true)});
	expect(plan.baseIndex == -1, "Expected no suitable destination base");
	expect(plan.agentIndices.empty(), "Expected no agents when there is no destination");
}

// Single suitable base is picked even when it is far away.
static void test_single_suitable_base()
{
	const std::vector<MedevacPlanner::BaseCandidate> bases = {
	    base(1000, false, 0), base(5000, false, 3), base(2, false, 0)};
	const auto plan = MedevacPlanner::plan(bases, 4, {agent(true), agent(true)});
	expect(plan.baseIndex == 1, "Expected the only base with capacity to be chosen");
	expect(plan.agentIndices.size() == 2, "Expected both wounded agents to be picked up");
	expect(plan.agentIndices[0] == 0 && plan.agentIndices[1] == 1,
	       "Expected agents in pick-up order");
}

// A home base is preferred over a nearer non-home base.
static void test_home_base_preferred()
{
	const std::vector<MedevacPlanner::BaseCandidate> bases = {
	    base(1, false, 5), base(100, true, 5)};
	const auto plan = MedevacPlanner::plan(bases, 4, {agent(true)});
	expect(plan.baseIndex == 1, "Expected home base to win over nearer non-home base");
}

// A home base without capacity does not win.
static void test_home_base_without_capacity()
{
	const std::vector<MedevacPlanner::BaseCandidate> bases = {
	    base(1, false, 5), base(100, true, 0)};
	const auto plan = MedevacPlanner::plan(bases, 4, {agent(true)});
	expect(plan.baseIndex == 0, "Expected nearest base with capacity to be chosen");
}

// Among non-home bases the nearest one wins; ties stay with the first entry.
static void test_nearest_non_home_base_and_ties()
{
	const std::vector<MedevacPlanner::BaseCandidate> bases = {
	    base(9, false, 1), base(4, false, 1), base(4, false, 1)};
	const auto plan = MedevacPlanner::plan(bases, 4, {agent(true)});
	expect(plan.baseIndex == 1, "Expected nearest base to be chosen");
	expect(plan.agentIndices.size() == 1, "Expected one agent to be picked up");

	const std::vector<MedevacPlanner::BaseCandidate> ties = {
	    base(4, false, 1), base(4, false, 1), base(9, false, 1)};
	const auto tiePlan = MedevacPlanner::plan(ties, 4, {agent(true)});
	expect(tiePlan.baseIndex == 0, "Expected first of the tied bases to be chosen");
}

// Multiple qualifying bases: the last home base wins (original loop replaces on every home).
static void test_last_home_base_wins()
{
	const std::vector<MedevacPlanner::BaseCandidate> bases = {
	    base(1, true, 5), base(50, false, 5), base(2, true, 5)};
	const auto plan = MedevacPlanner::plan(bases, 4, {agent(true)});
	expect(plan.baseIndex == 2, "Expected the last home base to be chosen");
}

// Free vehicle seats limit the number of boarded agents.
static void test_vehicle_seat_limit()
{
	const std::vector<MedevacPlanner::BaseCandidate> bases = {base(1, false, 10)};
	const std::vector<MedevacPlanner::AgentCandidate> agents = {
	    agent(true), agent(true), agent(true), agent(true)};
	const auto plan = MedevacPlanner::plan(bases, 2, agents);
	expect(plan.baseIndex == 0, "Expected destination base");
	expect(plan.agentIndices.size() == 2, "Expected boarding limited by free vehicle seats");
	expect(plan.agentIndices[0] == 0 && plan.agentIndices[1] == 1,
	       "Expected first agents in pick-up order");
}

// Free medical capacity of the chosen base limits boarding when smaller than seats.
static void test_medical_capacity_limit()
{
	const std::vector<MedevacPlanner::BaseCandidate> bases = {base(1, false, 2)};
	const std::vector<MedevacPlanner::AgentCandidate> agents = {
	    agent(true), agent(true), agent(true), agent(true)};
	const auto plan = MedevacPlanner::plan(bases, 6, agents);
	expect(plan.baseIndex == 0, "Expected destination base");
	expect(plan.agentIndices.size() == 2, "Expected boarding limited by medical capacity");
}

// Non-eligible agents (healthy, dead or non-X-COM) are skipped in order.
static void test_eligible_filtering()
{
	const std::vector<MedevacPlanner::BaseCandidate> bases = {base(1, false, 10)};
	const std::vector<MedevacPlanner::AgentCandidate> agents = {
	    agent(false), agent(true), agent(false), agent(true), agent(true)};
	const auto plan = MedevacPlanner::plan(bases, 6, agents);
	expect(plan.agentIndices.size() == 3, "Expected only eligible agents to be boarded");
	expect(plan.agentIndices[0] == 1 && plan.agentIndices[1] == 3 && plan.agentIndices[2] == 4,
	       "Expected eligible agents in pick-up order");
}

// No wounded agents => empty plan (mission will cancel).
static void test_no_eligible_agents()
{
	const std::vector<MedevacPlanner::BaseCandidate> bases = {base(1, false, 10)};
	const std::vector<MedevacPlanner::AgentCandidate> agents = {
	    agent(false), agent(false)};
	const auto plan = MedevacPlanner::plan(bases, 6, agents);
	expect(plan.baseIndex == 0, "Expected destination base");
	expect(plan.agentIndices.empty(), "Expected no agents to be boarded");
}

// No free vehicle seats => nothing is boarded.
static void test_no_free_seats()
{
	const std::vector<MedevacPlanner::BaseCandidate> bases = {base(1, false, 10)};
	const std::vector<MedevacPlanner::AgentCandidate> agents = {agent(true)};
	const auto plan = MedevacPlanner::plan(bases, 0, agents);
	expect(plan.baseIndex == 0, "Expected destination base");
	expect(plan.agentIndices.empty(), "Expected no agents with zero free seats");
}

// Empty inputs produce an empty plan instead of crashing.
static void test_empty_inputs()
{
	const auto plan = MedevacPlanner::plan({}, 4, {});
	expect(plan.baseIndex == -1, "Expected no destination for empty bases");
	expect(plan.agentIndices.empty(), "Expected no agents for empty input");
}

int main(int argc, char **argv)
{
	if (config().parseOptions(argc, argv))
	{
		return EXIT_FAILURE;
	}

	test_no_capacity_base();
	test_single_suitable_base();
	test_home_base_preferred();
	test_home_base_without_capacity();
	test_nearest_non_home_base_and_ties();
	test_last_home_base_wins();
	test_vehicle_seat_limit();
	test_medical_capacity_limit();
	test_eligible_filtering();
	test_no_eligible_agents();
	test_no_free_seats();
	test_empty_inputs();

	LogInfo("All medevac planner tests passed");
	return EXIT_SUCCESS;
}
