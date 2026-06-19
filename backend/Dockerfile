FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY ConstructIQ.API/ConstructIQ.API.csproj ConstructIQ.API/
RUN dotnet restore ConstructIQ.API/ConstructIQ.API.csproj

COPY . .
RUN dotnet publish ConstructIQ.API/ConstructIQ.API.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

EXPOSE 5000
ENV ASPNETCORE_URLS=http://+:5000

ENTRYPOINT ["dotnet", "ConstructIQ.API.dll"]
