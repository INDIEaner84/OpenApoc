#pragma once

// Pure medical-evacuation (F1) planning logic.
//
// The mission code in vehiclemission.cpp feeds live game objects (bases,
// buildings, agents, vehicle passenger capacity) through this planner, which
// decides
//   * which player base receives the wounded,
//   * which wounded X-COM soldiers are boarded.
//
// It intentionally does not depend on the game state so the decision logic can
// be unit tested without CD data or a full simulation.

#include <vector>

namespace OpenApoc
{

class MedevacPlanner
{
  public:
	struct BaseCandidate
	{
		// Squared distance from the pickup building to the base building
		// (mirrors the distance used by the city mission code).
		int distanceSquared = 0;
		// True if this base building is the vehicle's home building.
		bool isHomeBase = false;
		// Unused medical capacity of the base (capacity total - used).
		int freeMedicalCapacity = 0;
	};

	struct AgentCandidate
	{
		// True if the agent is a living, wounded X-COM soldier that may be
		// evacuated (owner is the player, role is Soldier, health between
		// zero and its current maximum).
		bool woundedXComSoldier = false;
	};

	struct Plan
	{
		// Index into the bases vector of the receiving base, or -1 if no
		// base with free medical capacity exists.
		int baseIndex = -1;
		// Indices (into the agents vector) of the agents to board, in
		// pick-up order and limited by both free vehicle seats and the free
		// medical capacity of the chosen base.
		std::vector<int> agentIndices;
	};

	// Selects the destination base following the original mission behaviour:
	//   - bases without free medical capacity are ignored,
	//   - a (any) home base wins over all non-home bases; when multiple
	//     candidates qualify the *last* one is chosen, matching the original
	//     loop which keeps replacing its destination on every qualifying base,
	//   - otherwise the base with the smallest distanceSquared wins; ties keep
	//     the first candidate (stable).
	// Returns -1 when no base is suitable.
	static int chooseDestinationBase(const std::vector<BaseCandidate> &bases)
	{
		int bestIndex = -1;
		int bestDistance = 0;
		for (size_t i = 0; i < bases.size(); i++)
		{
			const auto &base = bases[i];
			if (base.freeMedicalCapacity <= 0)
			{
				continue;
			}
			if (bestIndex == -1 || base.isHomeBase ||
			    (!bases[bestIndex].isHomeBase && base.distanceSquared < bestDistance))
			{
				bestIndex = static_cast<int>(i);
				bestDistance = base.distanceSquared;
			}
		}
		return bestIndex;
	}

	// Full pick-up plan for one evacuation run. Returns a plan with
	// baseIndex == -1 when no base has free medical capacity, and an empty
	// agentIndices list when there is nothing to pick up (no seats, no
	// capacity or no eligible wounded agents).
	static Plan plan(const std::vector<BaseCandidate> &bases, int freeVehicleSeats,
	                 const std::vector<AgentCandidate> &agents)
	{
		Plan result;
		result.baseIndex = chooseDestinationBase(bases);
		if (result.baseIndex == -1)
		{
			return result;
		}

		const int pickupLimit =
		    std::min(freeVehicleSeats, bases[result.baseIndex].freeMedicalCapacity);
		for (size_t i = 0; i < agents.size() && static_cast<int>(result.agentIndices.size()) <
		                                              pickupLimit;
		     i++)
		{
			if (agents[i].woundedXComSoldier)
			{
				result.agentIndices.push_back(static_cast<int>(i));
			}
		}
		return result;
	}
};

} // namespace OpenApoc
