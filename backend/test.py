from tools.hotel_tool import tavily_search
from tools.flight_tool import search_flights

# res = tavily_search("Best hotels in Nepal")
# print(res)

res = search_flights("Plan a 7-day trip from Bhutan to Thailand")
print(res)
