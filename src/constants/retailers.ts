import { ImageSourcePropType } from 'react-native'

export interface Retailer {
  key: string
  name: string
  logo: ImageSourcePropType
  active: boolean
}

export const RETAILERS: Retailer[] = [
  { key: 'amazon',    name: 'Amazon',    logo: require('../../assets/retailers/amazon.png'),    active: true  },
  { key: 'mercadona', name: 'Mercadona', logo: require('../../assets/retailers/mercadona.png'), active: false },
  { key: 'carrefour', name: 'Carrefour', logo: require('../../assets/retailers/carrefour.png'), active: false },
  { key: 'alcampo',   name: 'Alcampo',   logo: require('../../assets/retailers/Alcampo.png'),   active: false },
  { key: 'dia',       name: 'DIA',       logo: require('../../assets/retailers/dia.png'),       active: false },
  { key: 'lidl',      name: 'Lidl',      logo: require('../../assets/retailers/lidl.png'),      active: false },
]
