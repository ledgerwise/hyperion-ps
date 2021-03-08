require('dotenv').config();
const { EventEmitter } = require('events');
const axios = require('axios').default;
const logger = require('./src/logger')({
  //filename: 'indexer.log',
  loglabel: 'hyperion-ps',
});

if ((process.env.NODE_ENV = 'development')) logger.level = 'debug';

class HPSC extends EventEmitter {
  constructor({
    endpoints = [],
    fetchEndpointList = true,
    chainId,
    startBlock = 0,
    fetchDeltas = false,
    account,
    name,
    loopWait = 10,
    healthLoops = 35,
    simpleActions = false,
  }) {
    super();
    this.loopCounter = 0;
    this.endpoints = endpoints;
    this.fetchEndpointList = fetchEndpointList;
    this.chainId = chainId;
    this.healthyEndpoints = [];
    this.loopWait = loopWait * 1000;
    this.loops = 0;
    this.healthLoops = healthLoops;
    this.nextBlock = startBlock;
    this.account = account;
    this.name = name;
    this.simpleActions = simpleActions;
  }

  async fetchEndpoints() {
    const url = `https://api.ledgerwise.io/apps/nodestatus/${this.chainId}.json`;
    logger.debug(`Fetching endpoints from ${url}`);
    try {
      const response = await axios.get(url);
      if (response.status !== 200)
        throw `response.status.code response.status.text`;
      return [
        ...new Set(
          response.data.healthy_hyperion_endpoints.filter((e) =>
            e.startsWith('https')
          )
        ),
      ];
    } catch (error) {
      logger.error(`Error fetching endpoints: ${error}`);
    }
    return null;
  }

  async checkEndpointsHealth() {
    const result = await Promise.all(
      this.endpoints.map(async (endpoint) => {
        const url = `${endpoint}/v2/health`;
        const response = await axios.get(url);
        const servicesOk =
          response.data.health.filter((i) => i.status !== 'OK').length == 0;
        const featuresOk =
          response.data.features.index_deltas &&
          response.data.features.index_all_deltas &&
          response.data.features.index_transfer_memo;
        const elasticService = response.data.health.filter(
          (i) => i.service === 'Elasticsearch'
        );
        const indicesOk =
          elasticService?.service_data?.last_indexed_block ===
            elasticService?.service_data?.total_indexed_blocks &&
          elasticService?.service_data?.last_indexed_block !== null;
        const currentTime = Date.now();
        const timeOk =
          response.data.health.filter(
            (i) => Math.abs(i.time - currentTime) > this.loopWait
          ).length == 0;

        const status = servicesOk && featuresOk && indicesOk && timeOk;
        logger.debug(
          `${response.data.host} ${status} services: ${servicesOk} features: ${featuresOk} indices: ${indicesOk} time: ${timeOk}`
        );
        return {
          host: response.data.host,
          status: status,
        };
      })
    );
    return result.filter((e) => e.status).map((e) => `https://${e.host}`);
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  randomEndpoint() {
    return this.healthyEndpoints[
      Math.floor(Math.random() * this.healthyEndpoints.length)
    ];
  }

  async fetchActions() {
    const url = `${this.randomEndpoint()}/v2/history/get_actions?account=${
      this.account
    }&block_num=${
      this.nextBlock
    }-100000000000&limit=1000&noBinary=true&simple=${
      this.simpleActions
    }&sort=asc`;
    logger.debug(`Getting actions: ${url}`);
    try {
      const response = await axios.get(url, { timeout: 5000 });
      if (this.simpleActions) return response.data.simple_actions;
      else return response.data.actions;
    } catch (error) {
      logger.error(error);
      return [];
    }
  }

  async start() {
    if (this.fetchEndpointList) {
      const fetchedEndpoints = await this.fetchEndpoints();
      if (fetchedEndpoints) this.endpoints = fetchedEndpoints;
    }

    while (true) {
      //Check endpoints health
      if (this.loops % this.healthLoops === 0)
        this.healthyEndpoints = await this.checkEndpointsHealth();
      if (this.healthyEndpoints.length) {
        logger.debug(`Healthy endpoints: ${this.healthyEndpoints}`);
      } else {
        logger.error(`No healthy endpoints found`);
        return;
      }

      //Get actions
      const actions = await this.fetchActions();

      if (actions.length) {
        this.emit('actions', actions);
        this.nextBlock = actions[actions.length - 1].block + 1;
      }

      this.loops++;
      await this.sleep(this.loopWait);
    }
  }
}

module.exports = HPSC;

const client = new HPSC({
  endpoints: [
    'https://api.waxsweden.org',
    'https://api.wax.alohaeos.com',
    'https://wax.pink.gg',
  ],
  fetchEndpointList: true,
  chainId: '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4',
  startBlock: 4957000,
  fetchDeltas: false,
  account: 'koilamarkett',
  name: null,
});

logger.info('Starting client');
client.start();
client.on('actions', (actions) => {
  for (const action of actions) {
    console.log(`${action.block} ${action.timestamp} ${action.action}`);
  }
});
