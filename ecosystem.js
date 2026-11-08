const ecosystemBiomeCatalog = {
  'tropical-rainforest' : {temperature : 27, moisture : 0.78, tolerance : 0.36, minTemp : 18, maxTemp : 36, height : 4.5, visual : 'broadleaf', species : [
    ['ceiba', 'Ceiba pentandra', 'tree'], ['cacao', 'Theobroma cacao', 'broadleaf'], ['philodendron', 'Philodendron bipinnatifidum', 'fern'], ['rubber-tree', 'Hevea brasiliensis', 'tree'], ['brazil-nut', 'Bertholletia excelsa', 'tree'], ['strangler-fig', 'Ficus aurea', 'tree'], ['monstera', 'Monstera deliciosa', 'vine'], ['coconut-palm', 'Cocos nucifera', 'palm'], ['tree-fern', 'Cyathea arborea', 'fern'], ['heliconia', 'Heliconia bihai', 'flower']
  ]},
  'tropical-seasonal-woodland-savanna' : {temperature : 26, moisture : 0.34, tolerance : 0.42, minTemp : 10, maxTemp : 40, height : 4.5, visual : 'savanna', species : [
    ['baobab', 'Adansonia digitata', 'savanna'], ['umbrella-thorn', 'Vachellia tortilis', 'savanna'], ['whistling-thorn', 'Vachellia drepanolobium', 'savanna'], ['marula', 'Sclerocarya birrea', 'tree'], ['jackalberry', 'Diospyros mespiliformis', 'tree'], ['shepherd-tree', 'Boscia albitrunca', 'tree'], ['red-oat-grass', 'Themeda triandra', 'grass'], ['elephant-grass', 'Cenchrus purpureus', 'grass'], ['guinea-grass', 'Panicum maximum', 'grass'], ['mopane', 'Colophospermum mopane', 'savanna']
  ]},
  'desert-xeric-shrubland' : {temperature : 25, moisture : 0.14, tolerance : 0.30, minTemp : -8, maxTemp : 40, height : 2.2, visual : 'succulent', species : [
    ['agave', 'Agave americana', 'succulent'], ['saguaro', 'Carnegiea gigantea', 'cactus'], ['prickly-pear', 'Opuntia ficus-indica', 'cactus'], ['creosote-bush', 'Larrea tridentata', 'shrub'], ['sagebrush', 'Artemisia tridentata', 'shrub'], ['ocotillo', 'Fouquieria splendens', 'shrub'], ['mesquite', 'Prosopis glandulosa', 'savanna'], ['yucca', 'Yucca brevifolia', 'succulent'], ['aloe', 'Aloe vera', 'succulent'], ['tumbleweed', 'Kali tragus', 'shrub'],
    ['welwitschia', 'Welwitschia mirabilis', 'succulent', {moisture : 0.035, moistureTolerance : 0.12, droughtTolerance : 0.98, height : 1.1}],
    ['resurrection-plant', 'Selaginella lepidophylla', 'moss', {moisture : 0.025, moistureTolerance : 0.10, droughtTolerance : 1, height : 0.25}],
    ['fourwing-saltbush', 'Atriplex canescens', 'shrub', {moisture : 0.055, moistureTolerance : 0.16, droughtTolerance : 0.9, height : 1.2}],
    ['desert-ironwood', 'Olneya tesota', 'tree', {moisture : 0.07, moistureTolerance : 0.18, droughtTolerance : 0.88, height : 4}],
    ['brittlebush', 'Encelia farinosa', 'shrub', {moisture : 0.045, moistureTolerance : 0.14, droughtTolerance : 0.96, height : 0.9}],
    ['jojoba', 'Simmondsia chinensis', 'shrub', {moisture : 0.06, moistureTolerance : 0.16, droughtTolerance : 0.9, height : 1.5}],
    ['desert-lily', 'Hesperocallis undulata', 'flower', {moisture : 0.065, moistureTolerance : 0.17, droughtTolerance : 0.84, height : 0.6}],
    ['palo-verde', 'Parkinsonia florida', 'savanna', {moisture : 0.055, moistureTolerance : 0.16, droughtTolerance : 0.92, height : 3.2}],
    ['living-rock', 'Lithops aucampiae', 'succulent', {moisture : 0.02, moistureTolerance : 0.09, droughtTolerance : 1, height : 0.18}],
    ['camelthorn', 'Vachellia erioloba', 'savanna', {moisture : 0.08, moistureTolerance : 0.18, droughtTolerance : 0.86, height : 3}]
  ]},
  'mediterranean-woodland-shrubland' : {temperature : 19, moisture : 0.38, tolerance : 0.36, minTemp : -8, maxTemp : 34, height : 4, visual : 'shrub', species : [
    ['olive', 'Olea europaea', 'tree'], ['holm-oak', 'Quercus ilex', 'tree'], ['cork-oak', 'Quercus suber', 'tree'], ['stone-pine', 'Pinus pinea', 'conifer'], ['aleppo-pine', 'Pinus halepensis', 'conifer'], ['cypress', 'Cupressus sempervirens', 'conifer'], ['strawberry-tree', 'Arbutus unedo', 'shrub'], ['rosemary', 'Salvia rosmarinus', 'shrub'], ['lavender', 'Lavandula angustifolia', 'shrub'], ['rockrose', 'Cistus ladanifer', 'shrub']
  ]},
  'temperate-broadleaf-forest' : {temperature : 12, moisture : 0.62, tolerance : 0.38, minTemp : -28, maxTemp : 30, height : 5, visual : 'broadleaf', species : [
    ['maple', 'Acer saccharum', 'tree'], ['white-oak', 'Quercus alba', 'tree'], ['beech', 'Fagus grandifolia', 'tree'], ['red-maple', 'Acer rubrum', 'tree'], ['yellow-birch', 'Betula alleghaniensis', 'tree'], ['tulip-tree', 'Liriodendron tulipifera', 'tree'], ['black-cherry', 'Prunus serotina', 'tree'], ['basswood', 'Tilia americana', 'tree'], ['hickory', 'Carya ovata', 'tree'], ['ironwood', 'Ostrya virginiana', 'tree']
  ]},
  'temperate-coniferous-forest' : {temperature : 10, moisture : 0.72, tolerance : 0.36, minTemp : -25, maxTemp : 25, height : 5.5, visual : 'conifer', species : [
    ['hemlock', 'Tsuga heterophylla', 'conifer'], ['douglas-fir', 'Pseudotsuga menziesii', 'conifer'], ['coast-redwood', 'Sequoia sempervirens', 'conifer'], ['sitka-spruce', 'Picea sitchensis', 'conifer'], ['western-redcedar', 'Thuja plicata', 'conifer'], ['grand-fir', 'Abies grandis', 'conifer'], ['western-white-pine', 'Pinus monticola', 'conifer'], ['noble-fir', 'Abies procera', 'conifer'], ['lodgepole-pine', 'Pinus contorta', 'conifer'], ['pacific-yew', 'Taxus brevifolia', 'shrub']
  ]},
  'temperate-grassland' : {temperature : 14, moisture : 0.40, tolerance : 0.46, minTemp : -30, maxTemp : 34, height : 1.8, visual : 'grass', species : [
    ['bluegrass', 'Poa pratensis', 'grass'], ['switchgrass', 'Panicum virgatum', 'grass'], ['big-bluestem', 'Andropogon gerardii', 'grass'], ['little-bluestem', 'Schizachyrium scoparium', 'grass'], ['buffalo-grass', 'Bouteloua dactyloides', 'grass'], ['prairie-dropseed', 'Sporobolus heterolepis', 'grass'], ['needlegrass', 'Hesperostipa comata', 'grass'], ['purple-coneflower', 'Echinacea purpurea', 'flower'], ['black-eyed-susan', 'Rudbeckia hirta', 'flower'], ['prairie-clover', 'Dalea purpurea', 'flower']
  ]},
  'boreal-forest' : {temperature : 3, moisture : 0.54, tolerance : 0.42, minTemp : -42, maxTemp : 18, height : 5, visual : 'conifer', species : [
    ['tamarack', 'Larix laricina', 'conifer'], ['black-spruce', 'Picea mariana', 'conifer'], ['white-spruce', 'Picea glauca', 'conifer'], ['balsam-fir', 'Abies balsamea', 'conifer'], ['jack-pine', 'Pinus banksiana', 'conifer'], ['paper-birch', 'Betula papyrifera', 'tree'], ['quaking-aspen', 'Populus tremuloides', 'tree'], ['balsam-poplar', 'Populus balsamifera', 'tree'], ['willow', 'Salix arctica', 'shrub'], ['blueberry', 'Vaccinium myrtillus', 'shrub']
  ]},
  'tundra' : {temperature : -4, moisture : 0.46, tolerance : 0.44, minTemp : -42, maxTemp : 14, height : 1.1, visual : 'tundra', species : [
    ['dryas', 'Dryas octopetala', 'flower'], ['arctic-moss', 'Calliergon giganteum', 'moss'], ['arctic-willow', 'Salix arctica', 'shrub'], ['arctic-poppy', 'Papaver radicatum', 'flower'], ['purple-saxifrage', 'Saxifraga oppositifolia', 'flower'], ['bearberry', 'Arctostaphylos uva-ursi', 'shrub'], ['cloudberry', 'Rubus chamaemorus', 'flower'], ['cottongrass', 'Eriophorum angustifolium', 'grass'], ['reindeer-lichen', 'Cladonia rangiferina', 'moss'], ['mountain-avens', 'Dryas integrifolia', 'flower']
  ]},
  'alpine-montane' : {temperature : 4, moisture : 0.42, tolerance : 0.42, minTemp : -28, maxTemp : 16, height : 1.6, visual : 'alpine', species : [
    ['edelweiss', 'Leontopodium alpinum', 'flower'], ['alpine-aster', 'Aster alpinus', 'flower'], ['alpine-bluegrass', 'Poa alpina', 'grass'], ['moss-campion', 'Silene acaulis', 'flower'], ['alpine-saxifrage', 'Saxifraga oppositifolia', 'flower'], ['alpine-willow', 'Salix herbacea', 'shrub'], ['mountain-pine', 'Pinus mugo', 'conifer'], ['alpine-clover', 'Trifolium alpinum', 'flower'], ['alpine-poppy', 'Papaver alpinum', 'flower'], ['alpine-fescue', 'Festuca alpina', 'grass']
  ]}
};

const ecosystemBiomeAirMoisture = {
  'tropical-rainforest' : 0.78,
  'tropical-seasonal-woodland-savanna' : 0.48,
  'desert-xeric-shrubland' : 0.18,
  'mediterranean-woodland-shrubland' : 0.52,
  'temperate-broadleaf-forest' : 0.68,
  'temperate-coniferous-forest' : 0.72,
  'temperate-grassland' : 0.48,
  'boreal-forest' : 0.72,
  tundra : 0.62,
  'alpine-montane' : 0.48
};

const ecosystemSpecies = Object.entries(ecosystemBiomeCatalog).flatMap(([biome, profile]) =>
  profile.species.map(([id, name, visual, traits = {}], index) => ({
    id,
    name,
    biome,
    visual,
    minTemp : profile.minTemp + (index % 3 - 1) * 2,
    maxTemp : profile.maxTemp + (index % 4 - 1) * 1.5,
    moisture : traits.moisture !== undefined ? traits.moisture :
      Math.max(0.04, Math.min(0.95, profile.moisture + (index % 5 - 2) * 0.035)),
    moistureTolerance : traits.moistureTolerance || profile.tolerance,
    airMoisture : traits.airMoisture === undefined ? ecosystemBiomeAirMoisture[biome] : traits.airMoisture,
    airMoistureTolerance : traits.airMoistureTolerance || 0.55,
    droughtTolerance : traits.droughtTolerance || 0,
    height : traits.height || profile.height * (0.72 + (index % 5) * 0.14),
    reproduction : visual == 'grass' || visual == 'flower' || visual == 'moss' ? 0.008 : 0.002
  }))
);

class PlantEcosystem
{
  constructor()
  {
    this.sites = [];
    this.sprites = new Map();
    this.randomState = 1;
  }

  async generateSprites()
  {
    this.sprites.clear();
    for (const species of ecosystemSpecies)
      this.sprites.set(species.id, this.createProceduralSprite(species.visual, species.id, species.biome));
  }

  initialize(surfaceSites, environments, seed, latitude, cellHeight)
  {
    this.randomState = (seed >>> 0) || 1;
    this.sites = surfaceSites.map((surface, index) => {
      const environment = environments[index];
      const airMoisture = Number.isFinite(environment.airMoisture) ?
        this.clamp(environment.airMoisture, 0, 1) : 0.5;
      return {
        ...surface,
        active : environment.wallType == 1,
        temperature : environment.temperature,
        moisture : environment.moisture,
        airMoisture,
        wind : environment.wind || 0,
        snow : environment.snow,
        biome : this.classifyBiome(
          environment.temperature,
          environment.moisture,
          latitude,
          surface.y * cellHeight,
          airMoisture
        ),
        plant : null,
        seedBank : this.random() * 0.25
      };
    });

    for (const site of this.sites) {
      if (!site.active)
        continue;

      const species = this.selectSpecies(site);
      if (species) {
        const fitness = this.speciesFitness(species, site);
        const vegetationBoost = this.clamp(site.vegetation / 127, 0, 1) * 0.18;
        if (fitness > 0.30 && this.random() < 0.60 + fitness * 0.32 + vegetationBoost * 0.12)
          site.plant = this.createPlant(species, 0.45 + this.random() * 0.45);
      }
    }
  }

  update(hours, environments, latitude, daylight, cellHeight, wrapHorizontally)
  {
    environments.forEach(environment => {
      const site = this.sites[environment.siteIndex];
      if (!site)
        return;

      if (environment.wallType == 3) {
        site.plant = null;
        site.active = true;
        return;
      }
      if (environment.wallType != 1) {
        site.plant = null;
        site.active = false;
        return;
      }

      site.active = true;
      site.temperature += (environment.temperature - site.temperature) * 0.20;
      site.moisture += (environment.moisture - site.moisture) * 0.25;
      if (Number.isFinite(environment.airMoisture))
        site.airMoisture += (this.clamp(environment.airMoisture, 0, 1) - site.airMoisture) * 0.25;
      site.wind += ((environment.wind || 0) - site.wind) * 0.35;
      site.snow = environment.snow;
      site.biome = this.classifyBiome(
        site.temperature,
        site.moisture,
        latitude,
        site.y * cellHeight,
        site.airMoisture
      );
      if (site.plant && site.plant.species.biome != site.biome)
        site.plant = null;
    });

    const newSeedlings = [];
    for (let siteIndex = 0; siteIndex < this.sites.length; siteIndex++) {
      const site = this.sites[siteIndex];
      const plant = site.plant;
      if (!site.active)
        continue;

      if (!plant) {
        const species = this.selectSpecies(site);
        if (!species)
          continue;

        const fitness = this.speciesFitness(species, site);
        const daylightFactor = this.clamp(daylight * 1.5, 0, 1);
        if (fitness > 0.30 && daylightFactor > 0)
          site.seedBank += hours * (0.003 + fitness * 0.0145) * daylightFactor;

        if (site.seedBank >= 1) {
          site.seedBank -= 1;
          site.plant = this.createPlant(species, 0.08);
        }
        continue;
      }

      const species = plant.species;
      const fitness = this.speciesFitness(species, site);
      const frostStress = site.snow > 30 && species.minTemp > -15 ? 0.18 : 0;
      const soilDroughtStress = (1 - species.droughtTolerance) *
        this.clamp((species.moisture - site.moisture) / Math.max(0.08, species.moisture), 0, 1);
      const airDroughtStress = (1 - species.droughtTolerance) *
        this.clamp((species.airMoisture - site.airMoisture) / Math.max(0.12, species.airMoisture), 0, 1);
      const droughtStress = (soilDroughtStress * 0.65 + airDroughtStress * 0.35) * 0.55;
      const effectiveFitness = Math.max(0, fitness - frostStress - droughtStress);
      this.applyWindStress(plant, site.wind, hours);

      plant.ageHours += hours;
      plant.health = this.clamp(
        plant.health + hours * (effectiveFitness - 0.45) * 0.0012 -
          plant.windDamage * hours * 0.002 - droughtStress * hours * 0.004,
        0,
        1
      );
      plant.biomass = this.clamp(plant.biomass + hours * effectiveFitness * daylight * 0.004, 0, 1);

      if (plant.health < 0.04 || plant.windDamage >= 1 ||
          (plant.biomass < 0.05 && plant.ageHours > 120)) {
        site.plant = null;
        continue;
      }

      if (plant.biomass >= 0.62 && plant.health > 0.50 && effectiveFitness > 0.35) {
        plant.seedProgress += hours * species.reproduction * plant.health * effectiveFitness;
        if (plant.seedProgress >= 1) {
          plant.seedProgress = 0.4;
          const targetIndex = this.findSeedTarget(siteIndex, species, wrapHorizontally);
          if (targetIndex >= 0)
            newSeedlings.push({siteIndex : targetIndex, species});
        }
      }
    }

    for (const seedling of newSeedlings) {
      const site = this.sites[seedling.siteIndex];
      if (site.active && !site.plant && this.speciesFitness(seedling.species, site) > 0.30)
        site.plant = this.createPlant(seedling.species, 0.08);
    }
  }

  updateWind(environments)
  {
    for (const environment of environments) {
      const site = this.sites[environment.siteIndex];
      if (site)
        site.wind += ((environment.wind || 0) - site.wind) * 0.6;
    }
  }

  stepWindPhysics(deltaSeconds)
  {
    if (!Number.isFinite(deltaSeconds))
      return;
    const dt = this.clamp(deltaSeconds, 0, 0.05);
    if (dt == 0)
      return;

    for (const site of this.sites) {
      const plant = site.plant;
      if (!plant)
        continue;

      const height = Number.isFinite(plant.species.height) ?
        this.clamp(plant.species.height, 0.05, 100) : 0.05;
      const visual = plant.species.visual;
      const leafArea = Math.max(0.025, height * (visual == 'cactus' || visual == 'succulent' ? 0.08 : 0.18));
      const exposedArea = leafArea * (plant.clumpSize > 1 ? 0.72 : 1);
      const wind = Number.isFinite(site.wind) ? this.clamp(site.wind, -100, 100) : 0;
      const dragForce = 0.5 * 1.225 * 0.8 * exposedArea * wind * Math.abs(wind);
      const mass = Math.max(0.25, Math.pow(height, 1.5) * (visual == 'grass' || visual == 'flower' ? 2 : 8));
      const inertia = Math.max(0.02, mass * height * height / 3);
      const naturalFrequency = visual == 'grass' || visual == 'flower' || visual == 'moss' ? 1.3 :
        visual == 'shrub' || visual == 'vine' || visual == 'fern' || visual == 'palm' ? 1.8 : 2.4;
      const leanAngle = Number.isFinite(plant.leanAngle) ? plant.leanAngle : 0;
      const angularVelocity = Number.isFinite(plant.angularVelocity) ? plant.angularVelocity : 0;
      const angularAcceleration = Number.isFinite(mass) && Number.isFinite(inertia) ?
        dragForce * height * 0.5 / inertia - naturalFrequency * naturalFrequency * leanAngle -
          2 * 0.82 * naturalFrequency * angularVelocity : 0;
      plant.angularVelocity = Number.isFinite(angularAcceleration) ?
        this.clamp(angularVelocity + angularAcceleration * dt, -2.5, 2.5) : 0;
      plant.leanAngle = this.clamp(leanAngle + plant.angularVelocity * dt, -1.05, 1.05);
      plant.windForceN = Math.abs(dragForce);
    }
  }

  applyWindStress(plant, windSpeed, hours)
  {
    const resistance = this.getWindResistance(plant.species.visual) *
      (0.82 + plant.health * 0.18) * (1 - plant.windDamage * 0.35);
    const loadRatio = Math.pow(Math.abs(windSpeed) / resistance, 2);
    const overload = Math.max(0, loadRatio - 1);
    plant.windLoad = loadRatio;
    if (overload > 0) {
      plant.windStress = this.clamp(plant.windStress + hours * overload * 0.4, 0, 1.5);
      plant.windDamage = this.clamp(plant.windDamage + hours * Math.pow(overload, 1.25) * 0.06, 0, 1);
      if (plant.windStress > 0.2)
        plant.health = this.clamp(plant.health - hours * overload * 0.02, 0, 1);
    } else {
      plant.windStress = Math.max(0, plant.windStress - hours * 0.08);
      plant.windDamage = Math.max(0, plant.windDamage - hours * 0.0003);
    }
  }

  getWindResistance(visual)
  {
    if (visual == 'cactus' || visual == 'succulent' || visual == 'moss')
      return 42;
    if (visual == 'grass' || visual == 'flower' || visual == 'tundra' || visual == 'alpine')
      return 32;
    if (visual == 'shrub' || visual == 'savanna' || visual == 'palm')
      return 38;
    if (visual == 'conifer')
      return 48;
    return 40;
  }

  draw(context, projectX, projectY, cellPixels, simWidth, wrapHorizontally, pointerX, pointerY, timeSeconds)
  {
    const offsets = wrapHorizontally ? [-simWidth, 0, simWidth] : [0];
    let hoveredPlant = null;
    let closestPlantDistance = Infinity;
    for (const site of this.sites) {
      if (!site.plant)
        continue;

      const plant = site.plant;
      const sprite = this.sprites.get(plant.species.id);
      if (!sprite)
        continue;

      const height = Math.max(7, cellPixels * plant.species.height * plant.biomass *
        (1 - plant.windDamage * 0.4));
      const width = height * sprite.width / sprite.height;
      const screenY = projectY(site.y + 0.5);
      const gust = Math.sin(timeSeconds * 2.1 + site.x * 0.17 + site.y * 0.11) *
        Math.min(0.06, Math.abs(site.wind) * 0.0012);
      const bendDistance = Math.tan(plant.leanAngle + gust) * height;
      const clumpSize = plant.clumpSize || 1;
      context.globalAlpha = 0.35 + plant.health * 0.65;
      for (const offset of offsets) {
        const screenX = projectX(site.x + offset);
        for (let clumpIndex = 0; clumpIndex < clumpSize; clumpIndex++) {
          const scale = clumpSize == 1 ? 1 : (clumpIndex == Math.floor(clumpSize / 2) ? 1 : 0.58 + (clumpIndex % 2) * 0.12);
          const clumpOffset = clumpSize == 1 ? 0 : (clumpIndex - (clumpSize - 1) / 2) * width * 0.34;
          const plantX = screenX + clumpOffset;
          const plantWidth = width * scale;
          const plantHeight = height * scale;
          const plantBend = bendDistance * scale;
          const left = Math.min(plantX - plantWidth / 2, plantX - plantWidth / 2 + plantBend);
          const right = Math.max(plantX + plantWidth / 2, plantX + plantWidth / 2 + plantBend);
          if (right < 0 || left > context.canvas.width ||
              screenY < 0 || screenY - plantHeight > context.canvas.height)
            continue;

          this.drawBentSprite(context, sprite, plantX, screenY, plantWidth, plantHeight, plantBend);
          if (pointerX >= left && pointerX <= right &&
              pointerY >= screenY - plantHeight && pointerY <= screenY) {
            const distance = Math.abs(pointerX - plantX) + Math.abs(pointerY - screenY);
            if (distance < closestPlantDistance) {
              closestPlantDistance = distance;
              hoveredPlant = {plant, site};
            }
          }
        }
      }
    }
    context.globalAlpha = 1;
    return hoveredPlant;
  }

  drawBentSprite(context, sprite, x, rootY, width, height, bendDistance)
  {
    if (!Number.isFinite(height) || height <= 0 ||
        !Number.isFinite(width) || width <= 0 ||
        !Number.isFinite(bendDistance) || !Number.isFinite(x) || !Number.isFinite(rootY))
      return;
    const shear = -bendDistance / height;
    if (!Number.isFinite(shear))
      return;
    context.save();
    context.transform(1, 0, shear, 1, x, rootY);
    context.drawImage(sprite, -width / 2, -height, width, height);
    context.restore();
  }

  getPlantFlexibility(visual)
  {
    if (visual == 'grass' || visual == 'flower' || visual == 'moss' || visual == 'tundra' || visual == 'alpine')
      return 1.8;
    if (visual == 'shrub' || visual == 'vine' || visual == 'fern' || visual == 'succulent')
      return 1.15;
    if (visual == 'palm' || visual == 'savanna')
      return 0.8;
    if (visual == 'conifer' || visual == 'cactus')
      return 0.38;
    return 0.58;
  }

  getStatus()
  {
    const plants = this.sites.filter(site => site.plant);
    const speciesCount = new Set(plants.map(site => site.plant.species.id)).size;
    return plants.length + ' plants | ' + speciesCount + ' species';
  }

  createPlant(species, biomass)
  {
    const clumpable = species.visual == 'grass' || species.visual == 'flower' ||
      species.visual == 'moss' || species.visual == 'shrub';
    const clumpSize = clumpable ? 2 + Math.floor(this.random() * 4) : 1;
    return {
      species,
      biomass,
      health : 0.72 + this.random() * 0.24,
      ageHours : 0,
      seedProgress : 0,
      clumpSize,
      leanAngle : 0,
      angularVelocity : 0,
      windForceN : 0,
      windLoad : 0,
      windStress : 0,
      windDamage : 0
    };
  }

  selectSpecies(site)
  {
    const ranked = ecosystemSpecies
      .map(species => ({species, score : this.speciesFitness(species, site)}))
      .sort((a, b) => b.score - a.score)
      .filter(candidate => candidate.score > 0.16)
      .slice(0, 4);
    if (ranked.length == 0)
      return null;

    const total = ranked.reduce((sum, candidate) => sum + candidate.score, 0);
    let choice = this.random() * total;
    for (const candidate of ranked) {
      choice -= candidate.score;
      if (choice <= 0)
        return candidate.species;
    }
    return ranked[ranked.length - 1].species;
  }

  speciesFitness(species, site)
  {
    const tempDistance = site.temperature < species.minTemp ? species.minTemp - site.temperature :
      site.temperature > species.maxTemp ? site.temperature - species.maxTemp : 0;
    const temperatureFit = this.clamp(1 - tempDistance / 14, 0, 1);
    const soilMoistureFit = this.clamp(
      1 - Math.abs(site.moisture - species.moisture) / species.moistureTolerance,
      0,
      1
    );
    const siteAirMoisture = Number.isFinite(site.airMoisture) ? site.airMoisture : 0.5;
    const airMoistureFit = this.clamp(
      1 - Math.abs(siteAirMoisture - species.airMoisture) / species.airMoistureTolerance,
      0,
      1
    );
    const biomeFit = species.biome == site.biome ? 1 : 0;
    return temperatureFit * Math.sqrt(soilMoistureFit * airMoistureFit) * biomeFit;
  }

  classifyBiome(temperature, moisture, latitude, elevation, airMoisture = 0.5)
  {
    const absoluteLatitude = Math.abs(latitude);
    const relativeHumidity = this.clamp(airMoisture, 0, 1);
    if (elevation > 2400 || (elevation > 1600 && temperature < 5))
      return 'alpine-montane';
    if (moisture < 0.055 && relativeHumidity < 0.32 && temperature > -8)
      return 'desert-xeric-shrubland';
    if (temperature < 2)
      return absoluteLatitude > 58 && moisture > 0.22 ? 'boreal-forest' : 'tundra';
    if (absoluteLatitude > 58 && temperature < 12)
      return 'boreal-forest';
    if (temperature > 24) {
      if (moisture > 0.58 && relativeHumidity > 0.52)
        return 'tropical-rainforest';
      if (moisture < 0.16 && relativeHumidity < 0.42)
        return 'desert-xeric-shrubland';
      return 'tropical-seasonal-woodland-savanna';
    }
    if (temperature > 14 && absoluteLatitude >= 20 && absoluteLatitude <= 45 &&
        moisture >= 0.18 && moisture < 0.58 && relativeHumidity < 0.75)
      return 'mediterranean-woodland-shrubland';
    if (temperature > 8) {
      if (moisture < 0.24)
        return 'temperate-grassland';
      if (moisture < 0.40 && absoluteLatitude < 40)
        return 'mediterranean-woodland-shrubland';
      return absoluteLatitude > 45 ? 'temperate-coniferous-forest' : 'temperate-broadleaf-forest';
    }
    return absoluteLatitude > 45 ? 'boreal-forest' : 'temperate-coniferous-forest';
  }

  findSeedTarget(sourceIndex, species, wrapHorizontally)
  {
    if (this.sites.length === 0)
      return -1;
    const searchRadius = 1 + Math.floor(this.random() * 4);
    const candidates = [];
    for (let offset = -searchRadius; offset <= searchRadius; offset++) {
      if (offset == 0)
        continue;
      let targetIndex = sourceIndex + offset;
      if (wrapHorizontally && this.sites.length > 0)
        targetIndex = (targetIndex % this.sites.length + this.sites.length) % this.sites.length;
      else if (targetIndex < 0 || targetIndex >= this.sites.length)
        continue;
      if (targetIndex == sourceIndex)
        continue;
      const site = this.sites[targetIndex];
      if (site.active && !site.plant && this.speciesFitness(species, site) > 0.30)
        candidates.push(targetIndex);
    }
    return candidates.length ? candidates[Math.floor(this.random() * candidates.length)] : -1;
  }

  createProceduralSprite(type, speciesId, biome)
  {
    const sprite = document.createElement('canvas');
    sprite.width = 128;
    sprite.height = 192;
    const context = sprite.getContext('2d');
    context.lineCap = 'round';
    context.lineJoin = 'round';
    let hash = 2166136261;
    for (let i = 0; i < speciesId.length; i++)
      hash = Math.imul(hash ^ speciesId.charCodeAt(i), 16777619) >>> 0;
    const random = () => {
      hash = (hash * 1664525 + 1013904223) >>> 0;
      return hash / 4294967296;
    };
    const palettes = {
      tree : ['#476b38', '#668c4b', '#8ca75a'],
      broadleaf : ['#3d7545', '#609753', '#92ad5e'],
      conifer : ['#244f43', '#376b50', '#628252'],
      palm : ['#52834c', '#7da65a', '#b0b96b'],
      savanna : ['#65733d', '#87944b', '#b3a65b'],
      shrub : ['#536b3e', '#71844a', '#a09a58'],
      succulent : ['#477b60', '#69a17b', '#a4bc78'],
      cactus : ['#347254', '#4b9468', '#79ad70'],
      grass : ['#65843d', '#829d4b', '#b0ad59'],
      flower : ['#557a46', '#779653', '#e5c7d7'],
      fern : ['#34754b', '#4c9860', '#83b86d'],
      vine : ['#3d7046', '#5c9455', '#97b56b'],
      moss : ['#527247', '#769253', '#9cab68'],
      tundra : ['#637e4c', '#87975b', '#c4b678'],
      alpine : ['#55794c', '#81975c', '#ded8c4']
    };
    const colors = (palettes[type] || palettes.broadleaf).map(color =>
      this.adjustForBiome(color, biome)
    );
    const trunkBase = type == 'grass' || type == 'flower' || type == 'moss' || type == 'tundra' || type == 'alpine'
      ? '#718052'
      : '#765238';
    const trunk = this.adjustForBiome(trunkBase, biome);
    const leaf = (x, y, radiusX, radiusY, rotation, color) => {
      context.fillStyle = color;
      context.beginPath();
      context.ellipse(x, y, radiusX, radiusY, rotation, 0, Math.PI * 2);
      context.fill();
      if (radiusX > 8) {
        context.strokeStyle = 'rgba(224, 222, 157, 0.34)';
        context.lineWidth = 1.4;
        context.beginPath();
        context.moveTo(x - radiusX * 0.7, y + radiusY * 0.2);
        context.lineTo(x + radiusX * 0.7, y - radiusY * 0.2);
        context.stroke();
      }
    };
    const line = (x1, y1, x2, y2, width, color) => {
      context.strokeStyle = color;
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
    };

    if (type == 'grass' || type == 'flower' || type == 'tundra' || type == 'alpine') {
      const stems = type == 'grass' ? 13 : 5;
      for (let i = 0; i < stems; i++) {
        const baseX = 46 + random() * 36;
        const tipX = 18 + random() * 92;
        const tipY = 35 + random() * 72;
        line(baseX, 190, tipX, tipY, type == 'grass' ? 2 + random() * 2 : 2, colors[0]);
        if (type == 'flower') {
          const petalColor = colors[2];
          for (let petal = 0; petal < 7; petal++) {
            const angle = petal * Math.PI * 2 / 7;
            leaf(tipX + Math.cos(angle) * 7, tipY + Math.sin(angle) * 7, 4, 2.4, angle, petalColor);
          }
          context.fillStyle = this.adjustForBiome('#e5b94d', biome);
          context.beginPath();
          context.arc(tipX, tipY, 3.5, 0, Math.PI * 2);
          context.fill();
        } else {
          leaf(tipX, tipY, 7 + random() * 8, 2.5 + random() * 3, -0.7 + random() * 1.4, colors[1]);
        }
      }
    } else if (type == 'moss') {
      for (let i = 0; i < 5; i++)
        leaf(28 + i * 18, 162 + random() * 12, 19 + random() * 8, 12 + random() * 8, 0, colors[i % 2]);
      for (let i = 0; i < 28; i++) {
        context.fillStyle = colors[i % colors.length];
        context.beginPath();
        context.arc(16 + random() * 96, 148 + random() * 34, 1.5 + random() * 2.6, 0, Math.PI * 2);
        context.fill();
      }
    } else if (type == 'cactus') {
      line(64, 190, 64, 67, 17, colors[0]);
      line(57, 123, 40, 123, 12, colors[1]);
      line(35, 123, 35, 91, 11, colors[1]);
      line(71, 145, 88, 145, 12, colors[1]);
      line(94, 145, 94, 113, 11, colors[1]);
      for (let y = 77; y < 177; y += 14)
        line(60, y, 61 + (y % 3), y + 5, 1, this.adjustForBiome('#c1c986', biome));
    } else if (type == 'succulent') {
      for (let i = 0; i < 13; i++) {
        const angle = i * Math.PI * 2 / 13 - Math.PI / 2;
        const length = 28 + random() * 27;
        context.fillStyle = colors[i % colors.length];
        context.beginPath();
        context.moveTo(64, 178);
        context.quadraticCurveTo(64 + Math.cos(angle - 0.4) * length, 151 + Math.sin(angle) * length, 64 + Math.cos(angle) * length, 178 + Math.sin(angle) * 28);
        context.quadraticCurveTo(64 + Math.cos(angle + 0.25) * length * 0.4, 171, 64, 178);
        context.fill();
      }
    } else if (type == 'conifer') {
      line(64, 190, 64, 35, 5, trunk);
      for (let y = 49; y < 155; y += 17) {
        const width = (y - 30) * 0.56;
        for (let branch = -1; branch <= 1; branch++) {
          line(64, y, 64 + branch * width, y + 22, 2.2, colors[(y + branch + 100) % colors.length]);
          for (let needle = 0; needle < 7; needle++) {
            const along = needle / 7;
            const x = 64 + branch * width * along;
            const leafY = y + 20 * along;
            line(x, leafY, x + branch * 5, leafY + 5, 1.6, colors[1]);
          }
        }
      }
    } else if (type == 'palm') {
      line(64, 190, 62 + random() * 16, 57, 7, trunk);
      const crownX = 68;
      for (let i = 0; i < 9; i++) {
        const angle = Math.PI + i * Math.PI / 8;
        const endX = crownX + Math.cos(angle) * (38 + random() * 14);
        const endY = 48 + Math.sin(angle) * 52;
        context.strokeStyle = colors[i % colors.length];
        context.lineWidth = 3.2;
        context.beginPath();
        context.moveTo(crownX, 57);
        context.quadraticCurveTo(crownX + Math.cos(angle) * 20, endY + 10, endX, endY);
        context.stroke();
        for (let leaflet = 1; leaflet <= 6; leaflet++) {
          const t = leaflet / 7;
          const x = crownX + (endX - crownX) * t;
          const y = 57 + (endY - 57) * t;
          line(x, y, x + Math.sin(angle) * 8, y + 8, 1.8, colors[1]);
        }
      }
    } else if (type == 'fern' || type == 'vine') {
      line(64, 190, 64 + (random() - 0.5) * 25, 45, 4, trunk);
      for (let frond = 0; frond < 9; frond++) {
        const y = 70 + frond * 12;
        const side = frond % 2 ? 1 : -1;
        const length = 18 + random() * 22;
        line(64, y, 64 + side * length, y - 10, 1.8, colors[0]);
        for (let leaflet = 0; leaflet < 4; leaflet++)
          leaf(64 + side * length * (leaflet + 1) / 5, y - leaflet * 2, 7, 3, side * 0.4, colors[(frond + leaflet) % colors.length]);
      }
    } else {
      line(64, 190, 64 + (random() - 0.5) * 16, 75, 7, trunk);
      for (let branch = 0; branch < 8; branch++) {
        const y = 86 + branch * 11;
        const side = branch % 2 ? 1 : -1;
        const length = 18 + random() * 28;
        line(64, y, 64 + side * length, y - 18 - random() * 10, 2 + random() * 2, trunk);
        for (let leafIndex = 0; leafIndex < 4; leafIndex++) {
          const x = 64 + side * length * (leafIndex + 1) / 5;
          const leafY = y - leafIndex * 4;
          if (type == 'savanna') {
            leaf(x, leafY, 18, 7, 0, colors[(branch + leafIndex) % colors.length]);
          } else if (type == 'shrub') {
            leaf(x, leafY, 11 + random() * 7, 8 + random() * 4, random() * Math.PI, colors[(branch + leafIndex) % colors.length]);
          } else {
            leaf(x, leafY, 10 + random() * 8, 8 + random() * 7, random() * Math.PI, colors[(branch + leafIndex) % colors.length]);
          }
        }
      }
    }

    if (type != 'grass' && type != 'flower' && type != 'moss' && type != 'tundra' && type != 'alpine') {
      context.fillStyle = this.adjustForBiome('#735638', biome);
      context.beginPath();
      context.ellipse(64, 188, 12, 3, 0, 0, Math.PI * 2);
      context.fill();
    }
    return sprite;
  }

  adjustForBiome(color, biome, strength)
  {
    const dryBiomes = {
      'desert-xeric-shrubland' : {color : '#b49a68', amount : 0.48},
      'tropical-seasonal-woodland-savanna' : {color : '#a99b63', amount : 0.34},
      'mediterranean-woodland-shrubland' : {color : '#9a9670', amount : 0.22}
    };
    const dryTone = dryBiomes[biome];
    if (!dryTone)
      return color;

    const mix = strength === undefined ? dryTone.amount : strength;
    const source = color.match(/[a-f\d]{2}/gi);
    const target = dryTone.color.match(/[a-f\d]{2}/gi);
    const channels = source.map((channel, index) =>
      Math.round(parseInt(channel, 16) * (1 - mix) + parseInt(target[index], 16) * mix)
        .toString(16).padStart(2, '0')
    );
    return '#' + channels.join('');
  }

  random()
  {
    this.randomState = (this.randomState * 1664525 + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  clamp(value, minimum, maximum)
  {
    return Math.max(minimum, Math.min(maximum, value));
  }
}
